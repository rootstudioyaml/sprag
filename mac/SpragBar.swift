// Sprag Bar: the menu bar app that `sprag` starts on macOS.
//
// A runner in the menu bar moves faster the more of the machine the agent sessions use. A click opens a panel with every
// Claude Code and Codex session, the machine's CPU, memory and GPU split by who is using them, account limits, settings and
// rules. The dashboard window has three sizes: wide shows a band of machine figures, every session's tile, what is running now
// and the trends; middle the band and the tiles; narrow only the session list. The window's width picks the size.
//
// Session data comes from `sprag bar --json` (one child at a time, never overlapping). Machine totals, each process's CPU
// time and memory footprint, and GPU time per process come from the kernel and the I/O registry. A setting is changed by
// running the sprag command that owns it; this app writes no sprag file of its own except its pid file.
//
// The package ships this source, not a binary. `sprag bar build` compiles it on the user's Mac (src/bar-app.js):
//   swiftc -O -swift-version 5 mac/SpragBar.swift -o sprag-bar
// Arguments: --node <node> --cli <bin/cli.js> [--data-dir <dir>] [--version-tag <v>] [--ttl <seconds>] [--trace]
//            [--selftest <capture prefix> [--selftest-wait <seconds>] [--selftest-write]]
import AppKit
import SwiftUI
import Darwin
import IOKit

// ---------- data ----------
struct Win: Decodable { let key: String; let label: String; let usedPct: Double; let resetsAt: Double? }
struct Limits: Decodable { let plan: String?; let windows: [Win]; let at: Double? }
struct UsageTop: Decodable { let claude: Limits?; let codex: Limits? }
struct Ctx: Decodable { let tokens: Double; let window: Double?; let pct: Double? }
struct Tok: Decodable { let input: Double; let cacheRead: Double; let cacheWrite: Double; let output: Double }
struct SUsage: Decodable { let tokens: Tok; let requests: Double?; let costUsd: Double? }
struct DetailText: Decodable { let text: String; let at: Double? }
struct ToolCall: Decodable { let at: Double?; let tool: String; let target: String?; let pending: Bool? }
struct ProcItem: Decodable { let pid: Int; let name: String; let cpuPct: Double?; let rssMb: Double? }
struct Detail: Decodable { let prompt: DetailText?; let reply: DetailText?; let recent: [ToolCall]?; let procs: [ProcItem]? }
struct Session: Decodable, Identifiable {
    let cwd: String?; let detail: Detail?
    let agent: String; let pid: Int; let name: String?; let project: String?; let sessionId: String?
    let state: String?; let stateSince: Double?; let tools: [String]; let subagents: Int
    let cpu: Double?; let rssMb: Double?; let procs: Int?
    let cpuPct: Double?; let model: String?; let modelName: String?; let effort: String?; let context: Ctx?; let usage: SUsage?
    let compactions: Int?   // times the conversation was compacted; optional so a snapshot from an older sprag still decodes
    let title: String?      // what the session is about (rename, last prompt, topic); optional so a snapshot from an older sprag still decodes
    var id: Int { pid }
    /** What a row calls the session: its title, else Claude Code's own name, which is often the folder plus a number. */
    var label: String { if let t = title, !t.isEmpty { return t }; return name ?? agent }
    /** The tooltip form: the title and the name under it, or one of them when they are the same. */
    var fullName: String { let n = name ?? agent; return label == n ? n : label + "\n" + n }
}
struct Totals: Decodable { let sessions: Int; let busy: Int; let subagents: Int; let cpu: Double?; let rssMb: Double?; let procs: Int?; let costUsd: Double? }
struct Animal: Decodable { let grade: String; let emoji: String }
struct NextS: Decodable { let grade: String; let emoji: String; let name: String; let floorPct: Double?; let pass: Double?; let needDlg: Bool? }
struct Standing: Decodable { let grade: String; let emoji: String; let name: String; let org: String?; let rank: Double?; let ranked: Double?; let crown: Bool?; let idle: Bool?; let scorePct: Double?; let spendRank: Double?; let dlgRank: Double?; let next: NextS? }
struct Act: Decodable { let label: String?; let commands: [String]? }
struct Advice: Decodable, Identifiable { let code: String; let title: String?; let explain: String?; let tip: String?; let actions: [Act]?; var id: String { code } }
struct Warn: Decodable, Identifiable { let kind: String; let chip: String; let level: String; let since: Double?; let detail: String?; let resetsAt: Double?; let advice: [Advice]?; var id: String { chip } }
struct Snapshot: Decodable { let at: Double; let resources: Bool; let animal: Animal?; let totals: Totals; let sessions: [Session]; let cores: Int?; let usage: UsageTop?; let warnings: [Warn]?; let standing: Standing? }
struct Sample { var sysCpu = 0.0, claudeCpu = 0.0, codexCpu = 0.0, sysMem = 0.0, claudeMem = 0.0, codexMem = 0.0, gpu = 0.0, at = 0.0, cost = 0.0, claudeGpu = 0.0, codexGpu = 0.0, leftCpu = 0.0, leftMem = 0.0 }
struct Hist { let at: Double; let cpu: Double; let mem: Double; let gpu: Double }  // one reading of one session, for its trend lines  // each a fraction of the whole machine

struct RoutingS: Decodable { var enabled: Bool; var relaxed: Bool; var relaxUntil: Double? }
struct StatuslineS: Decodable { var compact: Int; var labels: String; var timer: Bool }
struct TeamS: Decodable { var joined: Bool; var teamName: String?; var displayName: String? }
struct CompactS: Decodable { var is1m: Bool; var value: Double?; var auto: Bool; var source: String?; var modelKey: String?; var ok: Bool; var reason: String; var recommended: Double; var min: Double; var max: Double; var warn: Bool }
struct Settings: Decodable { var routing: RoutingS; var statusline: StatuslineS; var language: String; var team: TeamS; var compactWindow: CompactS? }
struct RuleItem: Decodable { let index: Int; let text: String; let date: String?; let tags: [String]? }
struct RuleFile: Decodable { let path: String?; let exists: Bool; let bytes: Int; let tokens: Int; let rules: [RuleItem] }
struct ProjectRules: Decodable { let root: String; let name: String; let path: String?; let exists: Bool; let bytes: Int; let tokens: Int; let rules: [RuleItem] }
struct PresetItem: Decodable { let id: String; let text: String }
struct PresetRules: Decodable { let path: String?; let rules: [PresetItem]; let pending: [PresetItem] }
struct ModelRule: Decodable { let index: Int; let scope: String?; let root: String?; let label: String?; let tier: String?; let status: String?; let text: String; let example: String?; let count: Double?; let savedUsd: Double? }
struct ModelRules: Decodable { let enabled: Bool; let rules: [ModelRule] }
struct TeamRule: Decodable { let id: String?; let level: String; let scope: String; let text: String }
struct TeamRules: Decodable { let joined: Bool; let rules: [TeamRule] }
struct Rules: Decodable { let budgetTokens: Int; let global: RuleFile; let projects: [ProjectRules]; let preset: PresetRules; let model: ModelRules; let team: TeamRules }
enum Page: Equatable { case status, settings, rules, warning(String), session(Int) }
/** Which page the panel shows. */
final class Nav: ObservableObject {
    @Published var page: Page = .status { didSet { if page != oldValue { onChange?(page) } } }
    var onChange: ((Page) -> Void)?
}
/** Fit the window to its content again. Set by the app; called whenever a page grows or shrinks. */
var RELAYOUT: () -> Void = {}
func firstLine(_ t: String) -> String { t.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty } ?? "" }
func stripAnsi(_ t: String) -> String { t.replacingOccurrences(of: "\u{001B}\\[[0-9;?]*[A-Za-z]", with: "", options: .regularExpression) }
struct Opt: Identifiable { let id: String; let label: String; init(_ id: String, _ label: String) { self.id = id; self.label = label } }

var NODE = "/opt/homebrew/bin/node", CLI = "", TRACE = false
let CORES = Double(ProcessInfo.processInfo.activeProcessorCount)
let RAM_MB = Double(ProcessInfo.processInfo.physicalMemory) / 1048576
/** One process's time on the GPU since the last reading, as a fraction of the time that passed, and the session it runs under. */
struct GpuUse: Identifiable { let pid: Int32; let name: String; let share: Double; let session: Int?; var left = false; var id: Int32 { pid } }
struct GpuLine: Identifiable { let id: String; let label: String; let note: String; let share: Double; let agent: String?; var pid: Int? = nil }
/**
 * GPU time each process has used since it opened the GPU, in ns. The GPU driver keeps one entry per client process in the
 * I/O registry with its creator ("pid 404, name") and its accumulated GPU time; Activity Monitor's GPU column reads the same.
 */
func gpuClients() -> [Int32: (name: String, ns: Double)] {
    var out: [Int32: (name: String, ns: Double)] = [:]
    var it: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &it) == KERN_SUCCESS else { return out }
    defer { IOObjectRelease(it) }
    var acc = IOIteratorNext(it)
    while acc != 0 {
        var kids: io_iterator_t = 0
        if IORegistryEntryGetChildIterator(acc, kIOServicePlane, &kids) == KERN_SUCCESS {
            var c = IOIteratorNext(kids)
            while c != 0 {
                if let who = IORegistryEntryCreateCFProperty(c, "IOUserClientCreator" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String, who.hasPrefix("pid "),
                   let usage = IORegistryEntryCreateCFProperty(c, "AppUsage" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [[String: Any]] {
                    let parts = who.dropFirst(4).split(separator: ",", maxSplits: 1)
                    if let pid = Int32(parts.first.map(String.init) ?? "") {
                        let ns = usage.reduce(0.0) { $0 + (($1["accumulatedGPUTime"] as? NSNumber)?.doubleValue ?? 0) }
                        var e = out[pid] ?? (name: parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespaces) : "", ns: 0)
                        e.ns += ns; out[pid] = e
                    }
                }
                IOObjectRelease(c); c = IOIteratorNext(kids)
            }
            IOObjectRelease(kids)
        }
        IOObjectRelease(acc); acc = IOIteratorNext(it)
    }
    return out
}
func parentPid(_ pid: Int32) -> Int32? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size ? Int32(info.pbi_ppid) : nil
}
/** The session a process runs under: its nearest ancestor that is a session's own process. Another user's process cannot be read and has none. */
func sessionOf(_ pid: Int32, _ roots: Set<Int>) -> Int? {
    var cur = pid, hops = 0
    while cur > 1 && hops < 64 {
        if roots.contains(Int(cur)) { return Int(cur) }
        guard let up = parentPid(cur) else { return nil }
        cur = up; hops += 1
    }
    return nil
}
/** A process's working folder. */
func procCwd(_ pid: Int32) -> String? {
    var info = proc_vnodepathinfo()
    let size = Int32(MemoryLayout<proc_vnodepathinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, size) == size else { return nil }
    return withUnsafePointer(to: &info.pvi_cdir.vip_path) { $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) { String(cString: $0) } }
}
/** The executable's file name; the registry cuts names at 16 characters. */
func procName(_ pid: Int32, _ fallback: String) -> String {
    var buf = [CChar](repeating: 0, count: 4096)
    return proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 ? (String(cString: buf) as NSString).lastPathComponent : fallback
}
/** One process: CPU time used so far in ns, and its memory footprint in MB (resident, compressed and GPU-backed pages: Activity Monitor's Memory column). */
struct Proc { let pid: Int32; let ppid: Int32; let name: String; let start: UInt64; let cpuNs: Double; let memMb: Double }
struct Load { var cpu = 0.0, mem = 0.0, n = 0; mutating func add(_ c: Double, _ m: Double) { cpu += c; mem += m; n += 1 } }  // cpu: fraction of the whole machine
/** A session's load: its own process tree, and what it started detached (re-parented to launchd, so no longer under it). */
struct Work { var cpu = 0.0, mem = 0.0, gpu = 0.0, n = 0; mutating func add(_ c: Double, _ m: Double) { cpu += c; mem += m; n += 1 } }
struct Usage { var tree = Load(), detached = Load(); var names: [String: Load] = [:]; var work: [String: Work] = [:] }   // work: its programs by name, the agent itself left out
enum Phase: Int { case needsUser = 0, active = 1, idle = 2 }
struct AppLoad: Identifiable { let id: String; let name: String; let cpu: Double; let mem: Double; let n: Int }
let TIMEBASE: Double = { var t = mach_timebase_info_data_t(); mach_timebase_info(&t); return Double(t.numer) / Double(max(1, t.denom)) }()
/** Every process of this user. Another user's processes cannot be measured without privileges; they count in the machine totals only. */
func census() -> [Int32: Proc] {
    let n = proc_listallpids(nil, 0)
    guard n > 0 else { return [:] }
    var pids = [Int32](repeating: 0, count: Int(n) + 128)
    let got = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<Int32>.size))
    let me = getuid(), size = Int32(MemoryLayout<proc_bsdinfo>.size)
    var out: [Int32: Proc] = [:]
    for pid in pids.prefix(Int(max(0, got))) where pid > 1 {
        var info = proc_bsdinfo()
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size, info.pbi_uid == me else { continue }
        var ri = rusage_info_v2()
        let ok = withUnsafeMutablePointer(to: &ri) { $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V2, $0) } } == 0
        var name = withUnsafePointer(to: &info.pbi_name) { $0.withMemoryRebound(to: CChar.self, capacity: 33) { String(cString: $0) } }
        if name.isEmpty { name = withUnsafePointer(to: &info.pbi_comm) { $0.withMemoryRebound(to: CChar.self, capacity: 17) { String(cString: $0) } } }
        out[pid] = Proc(pid: pid, ppid: Int32(info.pbi_ppid), name: name, start: info.pbi_start_tvsec,
                        cpuNs: ok ? Double(ri.ri_user_time + ri.ri_system_time) * TIMEBASE : 0, memMb: ok ? Double(ri.ri_phys_footprint) / 1048576 : 0)
    }
    return out
}
var ARGBUF = [UInt8](repeating: 0, count: 1_048_576)
let SID_KEY = Array("CLAUDE_CODE_SESSION_ID=".utf8), PID_KEY = Array("CLAUDE_PID=".utf8), APP_KEY = Array("__CFBundleIdentifier=".utf8)
/**
 * The Claude session that started a process. Claude Code puts its session id and its own pid in the environment of every
 * child, and a child that was detached keeps them. Only those two values are read; nothing else of the environment is kept.
 */
func claudeOrigin(_ pid: Int32) -> (sid: String?, cpid: Int32?, title: String?, bundle: String?, vars: Int) {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = ARGBUF.count
    guard sysctl(&mib, 3, &ARGBUF, &size, nil, 0) == 0, size > 8 else { return (nil, nil, nil, nil, 0) }
    let argc = ARGBUF.withUnsafeBytes { $0.load(as: Int32.self) }
    var i = 4
    while i < size && ARGBUF[i] != 0 { i += 1 }    // the executable path
    while i < size && ARGBUF[i] == 0 { i += 1 }
    var left = argc, argv: [String] = []
    while left > 0 && i < size {
        let at = i
        while i < size && ARGBUF[i] != 0 { i += 1 }
        if argv.count < 4 { argv.append(String(decoding: ARGBUF[at..<min(i, at + 200)], as: UTF8.self)) }
        i += 1; left -= 1
    }
    // What the process is running, for programs whose own name says little (node, Python, a shell): the script, never its options.
    var title: String? = nil
    if let first = argv.first {
        let words = first.split(separator: " ")
        if words.count > 1 { title = words.prefix(4).joined(separator: " ") }
        else if let script = argv.dropFirst().first(where: { !$0.hasPrefix("-") && !$0.contains("=") }) { title = "\((first as NSString).lastPathComponent) \((script as NSString).lastPathComponent)" }
    }
    var sid: String? = nil, cpid: Int32? = nil, bundle: String? = nil, vars = 0
    func has(_ key: [UInt8], _ at: Int, _ end: Int) -> Bool { guard end - at > key.count else { return false }; for k in 0..<key.count where ARGBUF[at + k] != key[k] { return false }; return true }
    while i < size {
        let at = i
        while i < size && ARGBUF[i] != 0 { i += 1 }
        if i == at { break }
        vars += 1
        if has(SID_KEY, at, i) { sid = String(decoding: ARGBUF[(at + SID_KEY.count)..<i], as: UTF8.self) }
        else if has(PID_KEY, at, i) { cpid = Int32(String(decoding: ARGBUF[(at + PID_KEY.count)..<i], as: UTF8.self)) }
        else if has(APP_KEY, at, i) { bundle = String(decoding: ARGBUF[(at + APP_KEY.count)..<i], as: UTF8.self) }
        i += 1
    }
    return (sid, cpid, title.map { String($0.prefix(34)) }, bundle, vars)
}
/** The program the system holds responsible for a process: the app behind a virtual machine or an XPC helper. Optional: without it those helpers count as other programs. */
typealias ResponsibleFn = @convention(c) (pid_t) -> pid_t
let RESPONSIBLE: ResponsibleFn? = {
    guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else { return nil }
    return unsafeBitCast(sym, to: ResponsibleFn.self)
}()
let PLAIN_NAMES: Set<String> = ["node", "bash", "sh", "zsh", "ruby", "java", "perl", "npm", "npx", "deno", "bun", "tsx"]
/**
 * The app a session runs in. Its first ancestor that is a regular (Dock) application; when the chain ends at a daemon
 * instead (a terminal that keeps its shells in a background host, or tmux), the app named in the session's own
 * environment, which the system sets to the bundle that launched the shell.
 */
func owningApp(_ pid: Int) -> NSRunningApplication? {
    var cur = Int32(pid), hops = 0
    while cur > 1 && hops < 64 {
        if let app = NSRunningApplication(processIdentifier: cur), app.activationPolicy == .regular { return app }
        guard let up = parentPid(cur) else { break }
        cur = up; hops += 1
    }
    guard let bundle = claudeOrigin(Int32(pid)).bundle, !bundle.isEmpty else { return nil }
    return NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first { $0.activationPolicy == .regular }
}
/** Named variables from a process's environment, read the same way as claudeOrigin. Only the names asked for are kept. */
func envValues(_ pid: Int32, _ names: [String]) -> [String: String] {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = ARGBUF.count
    guard sysctl(&mib, 3, &ARGBUF, &size, nil, 0) == 0, size > 8 else { return [:] }
    var left = ARGBUF.withUnsafeBytes { $0.load(as: Int32.self) }, i = 4
    while i < size && ARGBUF[i] != 0 { i += 1 }
    while i < size && ARGBUF[i] == 0 { i += 1 }
    while left > 0 && i < size { while i < size && ARGBUF[i] != 0 { i += 1 }; i += 1; left -= 1 }
    var out: [String: String] = [:]
    while i < size {
        let at = i
        while i < size && ARGBUF[i] != 0 { i += 1 }
        if i == at { break }
        if ARGBUF[at] == 0x4f || ARGBUF[at] == 0x54 {   // only lines starting with O or T are decoded at all
            let line = String(decoding: ARGBUF[at..<i], as: UTF8.self)
            if let eq = line.firstIndex(of: "="), names.contains(String(line[..<eq])) { out[String(line[..<eq])] = String(line[line.index(after: eq)...]) }
        }
        i += 1
    }
    return out
}
/** The terminal tab a session lives in, when its terminal can be told to show one. Orca gives every shell a handle and ships a command that switches to it. */
func exactTab(_ s: Session) -> (tool: String, args: [String])? {
    let env = envValues(Int32(s.pid), ["ORCA_TERMINAL_HANDLE", "ORCA_CLI_BIN_DIR"])
    guard let handle = env["ORCA_TERMINAL_HANDLE"], handle.hasPrefix("term_"), handle.count < 80, handle.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }),
          let dir = env["ORCA_CLI_BIN_DIR"], dir.hasSuffix(".app/Contents/Resources/bin"), FileManager.default.isExecutableFile(atPath: dir + "/orca") else { return nil }
    return (dir + "/orca", ["terminal", "switch", "--terminal", handle])
}
/** Whether an app has a normal window on the current screen. Minimized and hidden windows are not on screen. Owner and layer are readable without the screen recording permission. */
func hasWindowOnScreen(_ pid: pid_t) -> Bool {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return true }
    return list.contains { ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid) && ($0[kCGWindowLayer as String] as? Int) == 0 }
}
/**
 * Go to a session: show its tab where the terminal allows it, then bring the terminal app to the front.
 * activate() only raises windows that are already open, so a terminal whose windows all sit in the Dock came forward with
 * nothing to show. Opening the running app again sends it the same reopen event a Dock click does, which restores a
 * minimized window (and unhides a hidden app) without asking for any permission. It is sent only when nothing of the
 * app is on screen, because some apps open a new window on every reopen.
 */
func jump(to s: Session) {
    if let tab = exactTab(s) {
        let p = Process(); p.executableURL = URL(fileURLWithPath: tab.tool); p.arguments = tab.args
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        try? p.run()
    }
    guard let app = owningApp(s.pid) else { return }
    if let script = TAB_SCRIPTS[app.bundleIdentifier ?? ""], let tty = ttyPath(Int32(s.pid)) {
        selectTab(script, tty: tty) { found in if !found { bringForward(app) } }
        return
    }
    bringForward(app)
}
/** The terminal device a process writes to (`/dev/ttys003`), or nil for one without a terminal. */
func ttyPath(_ pid: Int32) -> String? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size, info.e_tdev != UInt32.max, let name = devname(dev_t(bitPattern: info.e_tdev), S_IFCHR) else { return nil }
    return "/dev/" + String(cString: name)
}
/**
 * Terminals that name each tab's tty to AppleScript, with a script that selects the tab on the tty given as its argument,
 * restores and raises its window and prints true, or prints false when no tab has that tty. Running one asks once for the
 * Automation permission; refused, the script fails and the jump falls back to bringing the app forward.
 */
let TAB_SCRIPTS: [String: String] = [
    "com.apple.Terminal": """
    on run argv
      tell application id "com.apple.Terminal"
        repeat with w in windows
          repeat with t in tabs of w
            if tty of t is (item 1 of argv) then
              if miniaturized of w then set miniaturized of w to false
              set selected of t to true
              set index of w to 1
              activate
              return true
            end if
          end repeat
        end repeat
      end tell
      return false
    end run
    """,
    "com.googlecode.iterm2": """
    on run argv
      tell application id "com.googlecode.iterm2"
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              if tty of s is (item 1 of argv) then
                if miniaturized of w then set miniaturized of w to false
                select w
                tell t to select
                tell s to select
                activate
                return true
              end if
            end repeat
          end repeat
        end repeat
      end tell
      return false
    end run
    """,
]
/** Run a tab script off the main thread; `done` gets whether the tab was found, on the main thread. A permission prompt left unanswered gives up after a minute. */
func selectTab(_ script: String, tty: String, done: @escaping (Bool) -> Void) {
    let p = Process(), out = Pipe()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript"); p.arguments = ["-e", script, tty]
    p.standardOutput = out; p.standardError = FileHandle.nullDevice
    p.terminationHandler = { _ in
        let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        DispatchQueue.main.async { done(text == "true") }
    }
    do { try p.run() } catch { done(false); return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { if p.isRunning { p.terminate() } }
}
/** Bring a terminal app forward, restoring a minimized window when nothing of it is on screen (see jump). */
func bringForward(_ app: NSRunningApplication) {
    app.activate(options: [.activateAllWindows])
    if let url = app.bundleURL, app.isHidden || !hasWindowOnScreen(app.processIdentifier) {
        let cfg = NSWorkspace.OpenConfiguration(); cfg.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: cfg)
    }
}
/** The folder a Claude session worked in, read from its transcript (`<config>/projects/<folder>/<id>.jsonl`, whose lines carry `cwd`). */
func sessionCwd(_ sid: String) -> String? {
    let base = ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"].map { ($0 as NSString).expandingTildeInPath } ?? NSHomeDirectory() + "/.claude"
    let root = base + "/projects", fm = FileManager.default
    for dir in (try? fm.contentsOfDirectory(atPath: root)) ?? [] {
        let file = root + "/" + dir + "/" + sid + ".jsonl"
        guard let h = FileHandle(forReadingAtPath: file) else { continue }
        defer { try? h.close() }
        let head = h.readData(ofLength: 256 * 1024)
        for line in head.split(separator: UInt8(ascii: "\n")).prefix(200) {
            if let o = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any], let c = o["cwd"] as? String, fm.fileExists(atPath: c) { return c }
        }
    }
    return nil
}
/**
 * Reopen an ended Claude session in a new terminal window, in the folder it worked in, so a person can read what it was
 * doing before deciding whether to stop what it left running. Once it is back, its leftovers count as that session's again.
 */
@discardableResult func resumeSession(_ sid: String, fallbackDir: String?) -> Bool {
    guard !sid.isEmpty, sid.count <= 64, sid.allSatisfy({ $0.isHexDigit || $0 == "-" }) else { return false }
    let dir = sessionCwd(sid) ?? fallbackDir ?? NSHomeDirectory()
    let q = "'" + dir.replacingOccurrences(of: "'", with: "'\\''") + "'"
    // a login, interactive shell so PATH finds claude; the shell stays open after claude exits
    let script = "#!/bin/zsh\ncd \(q) || exit 1\nexec /bin/zsh -lic 'claude --resume \(sid); exec /bin/zsh -il'\n"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("sprag-resume-\(sid).command")
    do {
        try script.write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    } catch { return false }
    return NSWorkspace.shared.open(url)
}
/** A name a person recognises: the app for anything inside an .app bundle, else the executable's file name. */
func appName(_ pid: Int32, _ fallback: String) -> String {
    var buf = [CChar](repeating: 0, count: 4096)
    guard proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 else { return fallback }
    let path = String(cString: buf)
    if let r = path.range(of: ".app/") { return (String(path[..<r.lowerBound]) as NSString).lastPathComponent }
    return (path as NSString).lastPathComponent
}
/**
 * Programs that are not swept up with the rest when leftovers are cleaned: apps, virtual machines and databases. Other
 * work may depend on them (a Docker that an ended session started can be serving every project's local database), and
 * some hold data that a plain stop signal would cut off. They are stopped from their own app.
 */
/**
 * True when a process holds a TCP connection that is open both ways: something is talking to it, or it to something.
 * A dev server with a browser or a simulator attached is the case this is for.
 */
func hasOpenConnection(_ pid: Int32) -> Bool {
    let size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, nil, 0)
    guard size > 0 else { return false }
    var fds = [proc_fdinfo](repeating: proc_fdinfo(), count: Int(size) / MemoryLayout<proc_fdinfo>.size)
    let got = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, &fds, size)
    guard got > 0 else { return false }
    let want = Int32(MemoryLayout<socket_fdinfo>.size)
    for fd in fds.prefix(Int(got) / MemoryLayout<proc_fdinfo>.size) where fd.proc_fdtype == 2 {   // PROX_FDTYPE_SOCKET
        var info = socket_fdinfo()
        guard proc_pidfdinfo(pid, fd.proc_fd, PROC_PIDFDSOCKETINFO, &info, want) == want else { continue }
        if info.psi.soi_kind == 2 && info.psi.soi_proto.pri_tcp.tcpsi_state == 4 { return true }   // SOCKINFO_TCP, TSI_S_ESTABLISHED
    }
    return false
}
func isSharedService(_ p: Proc) -> Bool {
    var buf = [CChar](repeating: 0, count: 4096)
    let path = proc_pidpath(p.pid, &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : ""
    // An app bundle, but not the launcher a language runtime keeps inside its framework (Python.framework/.../Python.app):
    // a script run with that is an ordinary leftover.
    // A helper deep inside an app (Xcode.app/.../Some.framework/...) still counts as that app.
    if let app = path.range(of: ".app/") {
        let fw = path.range(of: ".framework/")
        if fw == nil || app.lowerBound < fw!.lowerBound { return true }
    }
    let name = ((path as NSString).lastPathComponent + " " + p.name).lowercased()
    return ["docker", "qemu", "virtualization", "colima", "podman", "postgres", "mysqld", "mongod", "redis-server", "simulator"].contains { name.contains($0) }
}
struct SessionGroup: Identifiable { let id: String; let name: String; let sessions: [Session] }
/**
 * Sessions of one project together: grouped by working folder, in the order the first of each group came, and a session
 * that another session started sits in its starter's group, right after it.
 */
func groupSessions(_ sessions: [Session], parents: [Int: Int]) -> [SessionGroup] {
    let byPid = Dictionary(sessions.map { ($0.pid, $0) }, uniquingKeysWith: { a, _ in a })
    func top(_ s: Session) -> Session { var cur = s, hops = 0; while let p = parents[cur.pid], let up = byPid[p], hops < 16 { cur = up; hops += 1 }; return cur }
    var order: [String] = [], members: [String: [Session]] = [:], names: [String: String] = [:]
    for s in sessions {
        let t = top(s), key = t.cwd ?? "pid:\(t.pid)"
        if members[key] == nil { order.append(key); names[key] = t.project ?? t.cwd.map { ($0 as NSString).lastPathComponent } ?? t.name ?? t.agent }
        members[key, default: []].append(s)
    }
    return order.map { key in
        let all = members[key] ?? []
        var out: [Session] = []
        func add(_ s: Session) { guard !out.contains(where: { $0.pid == s.pid }) else { return }; out.append(s); for c in all where parents[c.pid] == s.pid { add(c) } }
        for s in all where parents[s.pid].flatMap({ byPid[$0] }) == nil { add(s) }
        for s in all { add(s) }
        return SessionGroup(id: key, name: names[key] ?? key, sessions: out)
    }
}
let LEFT = Color(red: 0.56, green: 0.52, blue: 0.91)   // what ended sessions left running
let CARD_FILL = Color(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor.black.withAlphaComponent(0.22) : NSColor.white.withAlphaComponent(0.62) })
/** One whole split by who is using it, on a known scale: parts in order, the rest of the track empty. */
struct SplitBar: View {
    let parts: [(value: Double, color: Color)]; let scale: Double
    var body: some View {
        let full = max(scale, parts.reduce(0) { $0 + $1.value }, 0.000001)
        GeometryReader { g in
            HStack(spacing: 2) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, p in if p.value > 0 { Rectangle().fill(p.color).frame(width: max(3, (g.size.width - 2 * CGFloat(parts.count)) * CGFloat(p.value / full))) } }
                Rectangle().fill(Color.primary.opacity(0.12)).frame(maxWidth: .infinity)
            }.clipShape(Capsule())
        }.frame(height: 8)
    }
}
let CLAUDE = Color(red: 0.85, green: 0.47, blue: 0.34), CODEX = Color(red: 0.06, green: 0.64, blue: 0.50)
func agentTint(_ agent: String) -> Color { agent == "codex" ? CODEX : CLAUDE }

final class Box { var data = Data() }
/** Run the sprag CLI once and hand its exit code, stdout and stderr to `done` on the main queue. It is killed after `timeout` seconds. */
func sprag(_ args: [String], timeout: Double, cwd: String? = nil, _ done: @escaping (Int32, String, String) -> Void) {
    let p = Process(); p.executableURL = URL(fileURLWithPath: NODE); p.arguments = [CLI] + args
    // Not the folder the app was started from: `sprag routing` re-renders the rule file of the project it runs in.
    // A project rule command has to run inside its project, which is the only time `cwd` is given.
    p.currentDirectoryURL = URL(fileURLWithPath: cwd ?? ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
    let out = Pipe(), err = Pipe(); p.standardOutput = out; p.standardError = err; p.standardInput = FileHandle.nullDevice
    DispatchQueue.global(qos: .userInitiated).async {
        let o = Box(), e = Box(); var code: Int32 = -1
        do {
            try p.run()
            let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
            let g = DispatchGroup(); g.enter()
            DispatchQueue.global().async { e.data = err.fileHandleForReading.readDataToEndOfFile(); g.leave() }  // both pipes drained at once
            o.data = out.fileHandleForReading.readDataToEndOfFile(); g.wait(); p.waitUntilExit(); killer.cancel(); code = p.terminationStatus
        } catch { e.data = Data("실행하지 못했습니다: \(error.localizedDescription)".utf8) }
        DispatchQueue.main.async { done(code, String(decoding: o.data, as: UTF8.self), String(decoding: e.data, as: UTF8.self)) }
    }
}

/** Whole-machine CPU and memory, the figures Activity Monitor shows. */
final class Machine {
    private var last: [UInt64]?
    func cpu() -> Double? {  // fraction busy since the previous call
        var info = host_cpu_load_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info_data_t>.stride / MemoryLayout<integer_t>.stride)
        let kr = withUnsafeMutablePointer(to: &info) { p in p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count) } }
        guard kr == KERN_SUCCESS else { return nil }
        let now = [UInt64(info.cpu_ticks.0), UInt64(info.cpu_ticks.1), UInt64(info.cpu_ticks.2), UInt64(info.cpu_ticks.3)]  // user, system, idle, nice
        defer { last = now }
        guard let before = last else { return nil }
        let d = zip(now, before).map { $0 >= $1 ? Double($0 - $1) : 0 }
        let total = d.reduce(0, +)
        return total > 0 ? (d[0] + d[1] + d[3]) / total : nil
    }
    /** GPU load of the whole machine and the memory the GPU holds. macOS publishes no per-process figure, so it cannot be split by session. */
    func gpu() -> (load: Double, memMb: Double)? {
        var it: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &it) == KERN_SUCCESS else { return nil }
        defer { IOObjectRelease(it) }
        var best: (Double, Double)?
        var e = IOIteratorNext(it)
        while e != 0 {
            var props: Unmanaged<CFMutableDictionary>?
            if IORegistryEntryCreateCFProperties(e, &props, kCFAllocatorDefault, 0) == KERN_SUCCESS, let d = props?.takeRetainedValue() as? [String: Any],
               let st = d["PerformanceStatistics"] as? [String: Any], let u = st["Device Utilization %"] as? NSNumber {
                let m = (st["In use system memory"] as? NSNumber)?.doubleValue ?? 0
                if best == nil || u.doubleValue > best!.0 { best = (u.doubleValue, m / 1048576) }
            }
            IOObjectRelease(e); e = IOIteratorNext(it)
        }
        return best.map { (load: min(1, max(0, $0.0 / 100)), memMb: $0.1) }
    }
    func memUsedMb() -> Double? {
        var stats = vm_statistics64_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.stride / MemoryLayout<integer_t>.stride)
        let kr = withUnsafeMutablePointer(to: &stats) { p in p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) } }
        guard kr == KERN_SUCCESS else { return nil }
        var page: vm_size_t = 0; host_page_size(mach_host_self(), &page)
        let app = Double(stats.internal_page_count) - Double(stats.purgeable_count)
        return (max(0, app) + Double(stats.wire_count) + Double(stats.compressor_page_count)) * Double(page) / 1048576
    }
}

final class Model: ObservableObject {
    @Published var snap: Snapshot?
    @Published var samples: [Sample] = []
    @Published var failure: String?
    @Published var sysCpu: Double?
    @Published var sysMemMb: Double?
    @Published var gpu: Double?       // fraction of the whole machine's GPU in use
    @Published var gpuMemMb: Double?
    @Published var gpuUse: [GpuUse] = []      // who has been on the GPU since the last reading, largest first
    var gpuBySession: [Int: Double] = [:]     // session pid: its processes' share of that time
    var parentSession: [Int: Int] = [:]       // a session started from inside another session, child pid: starter pid
    private var gpuSeen: [Int32: Double] = [:]
    private var gpuSeenAt = 0.0
    @Published var usage: [Int: Usage] = [:]   // by session pid, from this app's own count of processes
    var leftover = Load()                      // processes a Claude session started that are still running after it ended
    var leftoverItems: [AppLoad] = []
    var others: [AppLoad] = []                 // this user's other programs, grouped by app
    var censusReady = false                    // CPU is a difference, so it needs two readings
    private var cpuSeen: [Int32: Double] = [:]
    private var cpuSeenAt = 0.0
    private var origins: [Int32: (start: UInt64, sid: String?, cpid: Int32?, title: String?, readable: Bool)] = [:]
    private var inherited: [Int32: (start: UInt64, sid: String?, cpid: Int32?)] = [:]   // a top whose own environment is hidden: what a descendant said
    var ownerOf: [Int32: Int] = [:]            // process: the session it is charged to, or -1 for one an ended session left
    var labelOf: [Int32: String] = [:]         // process of a live session: the name its load is listed under
    var leftoverPids: [String: [(pid: Int32, start: UInt64)]] = [:]   // each leftover line: its processes, with the start time that identifies them
    var leftoverShared: Set<String> = []       // leftover lines that are apps, virtual machines or databases: never part of a clean-up
    var leftoverWhere: [String: String] = [:]  // each leftover line: the folder it runs in, which names the project its session worked on
    var leftoverSession: [String: String] = [:] // each leftover line: the id of the ended Claude session that started it
    /** The leftover lines that hold an open connection right now. Read when the clean-up choices open, not on every poll. */
    func leftoverBusy(_ labels: [String]) -> Set<String> {
        Set(labels.filter { label in (leftoverPids[label] ?? []).contains { hasOpenConnection($0.pid) } })
    }
    private var bornOf: [Int: (sid: String?, cpid: Int32?)] = [:]   // session pid: the session marker it was started with
    private var appNames: [Int32: (start: UInt64, name: String)] = [:]
    private var running = false
    var hist: [Int: [Hist]] = [:]   // per session pid, the last 60 readings
    private func origin(_ p: Proc) -> (sid: String?, cpid: Int32?, title: String?, readable: Bool) {
        if let o = origins[p.pid], o.start == p.start { return (o.sid, o.cpid, o.title, o.readable) }
        let o = claudeOrigin(p.pid); origins[p.pid] = (p.start, o.sid, o.cpid, o.title, o.vars > 0); return (o.sid, o.cpid, o.title, o.vars > 0)
    }
    /**
     * Who started a tree whose top hides its environment. The system does not hand out the environment of its own
     * binaries, and a detached job is usually `/bin/bash script.sh`. The first descendant that can be read answers: it
     * inherited the same environment. Nothing is remembered until one can be read, so a script that has not started a
     * child yet is asked again at the next reading.
     */
    private func inheritedOrigin(_ top: Proc, _ kids: [Int32: [Int32]], _ all: [Int32: Proc]) -> (sid: String?, cpid: Int32?)? {
        if let o = inherited[top.pid], o.start == top.start { return (o.sid, o.cpid) }
        var queue = kids[top.pid] ?? [], seen = 0
        while !queue.isEmpty && seen < 24 {
            let pid = queue.removeFirst(); seen += 1
            guard let p = all[pid] else { continue }
            let o = origin(p)
            if o.readable { inherited[top.pid] = (top.start, o.sid, o.cpid); return (o.sid, o.cpid) }
            queue.append(contentsOf: kids[pid] ?? [])
        }
        return nil
    }
    private func nameOf(_ p: Proc) -> String {
        if let o = appNames[p.pid], o.start == p.start { return o.name }
        var n = appName(p.pid, p.name)
        if PLAIN_NAMES.contains(n) || n.lowercased().hasPrefix("python"), let t = origin(p).title, !t.isEmpty { n = t }
        appNames[p.pid] = (p.start, n); return n
    }
    /**
     * Charges every process of this user to one of four owners: a live session whose tree it is in, a live session that
     * started it detached, an ended session that left it behind, or nobody. `ps`-style resident size misses compressed and
     * GPU-backed memory and a tree walk misses detached work, which is how a machine out of memory could show almost no AI load.
     */
    func readCensus(_ sessions: [Session]) {
        let now = Date().timeIntervalSince1970, all = census()
        guard !all.isEmpty else { return }
        let span = cpuSeenAt > 0 && now - cpuSeenAt > 0.2 ? (now - cpuSeenAt) * 1e9 * CORES : 0
        let roots = Set(sessions.map { Int32($0.pid) })
        let bySid = Dictionary(sessions.compactMap { s in s.sessionId.map { ($0, s.pid) } }, uniquingKeysWith: { a, _ in a })
        // 1. each process: its CPU since the last reading, the session whose tree it is in, or else the top of its own tree
        struct Row { let p: Proc; let cpu: Double; let owner: Int32?; let top: Proc }
        enum Cls { case session(Int), left, other }
        var rows: [Row] = [], treeOwner: [Int32: Int32] = [:], topOf: [Int32: Int32] = [:]
        rows.reserveCapacity(all.count)
        for p in all.values {
            var cpu = 0.0
            if span > 0, let before = cpuSeen[p.pid], p.cpuNs >= before { cpu = (p.cpuNs - before) / span }
            var cur = p, owner: Int32? = nil, hops = 0
            while hops < 64 {
                if roots.contains(cur.pid) { owner = cur.pid; break }
                guard cur.ppid > 1, let up = all[cur.ppid] else { break }
                cur = up; hops += 1
            }
            if let o = owner { treeOwner[p.pid] = o } else { topOf[p.pid] = cur.pid }
            rows.append(Row(p: p, cpu: cpu, owner: owner, top: cur))
        }
        // 2. each tree outside the sessions: which session started it, if any
        var cls: [Int32: Cls] = [:], nameAs: [Int32: Proc] = [:], kids: [Int32: [Int32]] = [:]
        for p in all.values { kids[p.ppid, default: []].append(p.pid) }
        let home = NSHomeDirectory()
        var leftSid: [Int32: String] = [:]   // top of a leftover tree: the ended session that started it
        for r in rows where r.owner == nil && cls[r.top.pid] == nil {
            let own = origin(r.top)
            var sid = own.sid, cpid = own.cpid
            if sid == nil && cpid == nil && !own.readable, let o = inheritedOrigin(r.top, kids, all) { sid = o.sid; cpid = o.cpid }
            var live: Int? = sid.flatMap { bySid[$0] }
            if live == nil, let cp = cpid, roots.contains(cp), let root = all[cp], root.start <= r.top.start { live = Int(cp) }
            // No marker anywhere, the top hides its environment, and it works in the folder of exactly one live session: that session's.
            if live == nil, sid == nil, cpid == nil, !own.readable, let dir = procCwd(r.top.pid), dir != home, dir != "/" {
                let here = sessions.filter { $0.cwd == dir }
                if here.count == 1 { live = here[0].pid }
            }
            if let o = live { cls[r.top.pid] = .session(o) } else { cls[r.top.pid] = (sid != nil || cpid != nil) ? .left : .other; if let s = sid { leftSid[r.top.pid] = s } }
        }
        // 3. a helper the system started on a program's behalf (a virtual machine, an XPC service) goes where that program went
        if let responsible = RESPONSIBLE {
            for (top, c) in cls {
                guard case .other = c else { continue }
                let r = responsible(top)
                guard r > 1, r != top else { continue }
                if let o = treeOwner[r] { cls[top] = .session(Int(o)); nameAs[top] = all[r] }
                else if let t = topOf[r], t != top, let c2 = cls[t] { if case .other = c2 { continue }; cls[top] = c2; nameAs[top] = all[t]; if let s = leftSid[t] { leftSid[top] = s } }
            }
        }
        var use: [Int: Usage] = [:], left = Load(), leftBy: [String: Load] = [:], otherBy: [String: Load] = [:], owners: [Int32: Int] = [:], labels: [Int32: String] = [:]
        var leftProcs: [String: [(pid: Int32, start: UInt64)]] = [:], shared: Set<String> = [], leftWhere: [String: String] = [:], leftSession: [String: String] = [:]
        let nowSec = UInt64(now)
        for r in rows {
            if let o = r.owner {
                var u = use[Int(o), default: Usage()]; u.tree.add(r.cpu, r.p.memMb)
                // The agent's own process is the session, not something it is running; a child a few seconds old is usually a status line refresh.
                if r.p.pid != o, nowSec >= r.p.start + 5 { let l = nameOf(r.p); u.work[l, default: Work()].add(r.cpu, r.p.memMb); labels[r.p.pid] = l }
                use[Int(o)] = u; owners[r.p.pid] = Int(o); continue
            }
            let label = nameOf(nameAs[r.top.pid] ?? r.top)
            switch cls[r.top.pid] ?? .other {
            case .session(let o): var u = use[o, default: Usage()]; u.detached.add(r.cpu, r.p.memMb); u.names[label, default: Load()].add(r.cpu, r.p.memMb); u.work[label, default: Work()].add(r.cpu, r.p.memMb); labels[r.p.pid] = label; use[o] = u; owners[r.p.pid] = o
            case .left:
                left.add(r.cpu, r.p.memMb); leftBy[label, default: Load()].add(r.cpu, r.p.memMb); owners[r.p.pid] = -1
                leftProcs[label, default: []].append((pid: r.p.pid, start: r.p.start))
                if leftWhere[label] == nil, let c = procCwd(r.p.pid), c.count > 1, c != NSHomeDirectory() { leftWhere[label] = (c as NSString).lastPathComponent }
                if leftSession[label] == nil, let s = leftSid[r.top.pid] { leftSession[label] = s }
                if !shared.contains(label), isSharedService(nameAs[r.top.pid] ?? r.top) || isSharedService(r.top) { shared.insert(label) }
            case .other: otherBy[label, default: Load()].add(r.cpu, r.p.memMb)
            }
        }
        ownerOf = owners; labelOf = labels; leftoverPids = leftProcs; leftoverShared = shared; leftoverWhere = leftWhere; leftoverSession = leftSession
        cpuSeen = all.mapValues { $0.cpuNs }; cpuSeenAt = now; if span > 0 { censusReady = true }
        origins = origins.filter { all[$0.key] != nil }; appNames = appNames.filter { all[$0.key] != nil }; inherited = inherited.filter { all[$0.key] != nil }
        let list: ([String: Load]) -> [AppLoad] = { d in d.map { AppLoad(id: $0.key, name: $0.key, cpu: $0.value.cpu, mem: $0.value.mem, n: $0.value.n) }.sorted { $0.mem > $1.mem } }
        usage = use; leftover = left; leftoverItems = list(leftBy); others = list(otherBy)
    }
    /**
     * Whether a session is working, waiting for the user, or resting. Working is judged by evidence, not only by the
     * agent's own state: a session whose programs are busy is working even while the agent sits at its prompt.
     */
    func phase(_ s: Session) -> Phase {
        if s.state == "waiting" { return .needsUser }
        if s.state == "busy" || s.state == "shell" || s.subagents > 0 { return .active }
        guard let u = usage[s.pid] else { return .idle }
        return u.work.values.contains { $0.cpu >= 0.02 || $0.gpu >= 0.05 } ? .active : .idle
    }
    /** The programs a session is running that are doing something, heaviest first. */
    func working(_ s: Session, max n: Int = 2) -> [(name: String, w: Work)] {
        guard let u = usage[s.pid] else { return [] }
        let score: (Work) -> Double = { $0.cpu * 100 + $0.gpu * 100 + $0.mem / 2048 }
        return u.work.filter { !$0.key.isEmpty && ($0.value.cpu >= 0.004 || $0.value.gpu >= 0.01 || $0.value.mem >= 1024) }
            .sorted { score($0.value) != score($1.value) ? score($0.value) > score($1.value) : $0.key < $1.key }.prefix(n).map { (name: $0.key, w: $0.value) }
    }
    /** Who needs the user first, then who is working, then the rest; inside each the order they came in. */
    func ordered(_ sessions: [Session]) -> [Session] {
        sessions.enumerated().sorted { let a = phase($0.element).rawValue, b = phase($1.element).rawValue; return a != b ? a < b : $0.offset < $1.offset }.map { $0.element }
    }
    /**
     * Ask what ended sessions left behind to stop. Nothing shared is touched, and every process is checked again right
     * before the signal: it must still be the one that was counted (same pid and start time, this user's), not a live
     * session and not this app. Returns how many were signalled.
     */
    @discardableResult func stopLeftovers(_ labels: [String], force: Bool = false) -> Int {
        var sent = 0
        let sessions = Set((snap?.sessions ?? []).map { Int32($0.pid) }), size = Int32(MemoryLayout<proc_bsdinfo>.size)
        for label in labels where !leftoverShared.contains(label) {
            for one in leftoverPids[label] ?? [] where one.pid > 1 && one.pid != getpid() && !sessions.contains(one.pid) {
                var info = proc_bsdinfo()
                guard proc_pidinfo(one.pid, PROC_PIDTBSDINFO, 0, &info, size) == size, info.pbi_start_tvsec == one.start, info.pbi_uid == getuid() else { continue }
                if kill(one.pid, force ? SIGKILL : SIGTERM) == 0 { sent += 1 }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.refresh() }
        return sent
    }
    /** GPU time is a running total per process, so use is the difference between two readings. A process first seen now is counted from the next one. */
    func readGpuUse(_ roots: Set<Int>) {
        let now = Date().timeIntervalSince1970, seen = gpuClients()
        if gpuSeenAt > 0, now - gpuSeenAt > 0.2 {
            let span = (now - gpuSeenAt) * 1e9
            var use: [GpuUse] = [], by: [Int: Double] = [:]
            for (pid, c) in seen {
                guard let before = gpuSeen[pid], c.ns > before else { continue }
                let share = min(1, (c.ns - before) / span)
                guard share >= 0.001 else { continue }
                let charged = ownerOf[pid] ?? sessionOf(pid, roots).map { $0 }
                let owner = charged.flatMap { $0 >= 0 ? $0 : nil }
                use.append(GpuUse(pid: pid, name: procName(pid, c.name), share: share, session: owner, left: charged == -1))
                if let o = owner { by[o, default: 0] += share; if let l = labelOf[pid] { usage[o]?.work[l, default: Work()].gpu += share } }
            }
            gpuUse = use.sorted { $0.share > $1.share }; gpuBySession = by.mapValues { min(1, $0) }
        }
        gpuSeen = seen.mapValues { $0.ns }; gpuSeenAt = now
    }
    /** Who is on the GPU, largest first: a line per session (with the processes doing it) and a line per process outside any session. */
    func gpuLines(_ sessions: [Session], max n: Int = 4) -> [GpuLine] {
        var out: [GpuLine] = []
        for s in sessions {
            let mine = gpuUse.filter { $0.session == s.pid }
            guard !mine.isEmpty else { continue }
            out.append(GpuLine(id: "s\(s.pid)", label: s.label, note: mine.prefix(2).map { $0.name }.joined(separator: ", "), share: min(1, mine.reduce(0) { $0 + $1.share }), agent: s.agent, pid: s.pid))
        }
        for u in gpuUse where u.session == nil { out.append(GpuLine(id: "p\(u.pid)", label: u.name, note: u.left ? "끝난 세션이 남긴 것" : "", share: u.share, agent: u.left ? "left" : nil)) }
        return Array(out.sorted { $0.share > $1.share }.prefix(n))
    }
    var wantDetail = false          // a session page or the dashboard is showing: ask the CLI for each session's work as well
    @Published var detailOff = false // this CLI has no --detail
    private let machine = Machine()
    var onUpdate: (() -> Void)?
    // One reading is an instant. A statusline refresh under an idle session lives a fraction of a second, so it was in one poll and
    // gone from the next, and every figure jumped while nothing was happening. Each figure shown is the middle of the last readings.
    private struct Reading { let at: Double; let cpu: [Int: Double]; let mem: [Int: Double] }
    private var readings: [Reading] = []
    private func middle(_ pick: (Reading) -> Double?) -> Double? {
        guard let last = readings.last else { return nil }
        let v = readings.filter { last.at - $0.at <= 11 }.suffix(5).compactMap(pick).sorted()
        return v.isEmpty ? nil : v[(v.count - 1) / 2]
    }
    static func raw(_ s: Session) -> Double { s.cpuPct ?? (s.cpu ?? 0) / CORES }
    // The app's own count comes first: it includes detached work and the full memory footprint. The CLI's figures are the fallback.
    func cpuOf(_ s: Session) -> Double { if censusReady, let u = usage[s.pid] { return (u.tree.cpu + u.detached.cpu) * 100 }; return middle { $0.cpu[s.pid] } ?? Model.raw(s) }  // a percentage of the whole machine
    func memOf(_ s: Session) -> Double { if let u = usage[s.pid], u.tree.n > 0 { return u.tree.mem + u.detached.mem }; return middle { $0.mem[s.pid] } ?? (s.rssMb ?? 0) }
    func share(_ agent: String?) -> Double { (snap?.sessions ?? []).filter { agent == nil || $0.agent == agent }.reduce(0) { $0 + cpuOf($1) } }
    func mem(_ agent: String?) -> Double { (snap?.sessions ?? []).filter { agent == nil || $0.agent == agent }.reduce(0) { $0 + memOf($1) } }
    func refresh() {
        if running { return }  // the previous child has not returned: never stack a second one on it
        running = true
        let p = Process(); p.executableURL = URL(fileURLWithPath: NODE); let detailed = wantDetail && !detailOff
        p.arguments = [CLI, "bar", "--json"] + (detailed ? ["--detail"] : [])
        let out = Pipe(); p.standardOutput = out; p.standardError = FileHandle.nullDevice
        DispatchQueue.global(qos: .utility).async {
            var data = Data(); var err: String?
            do {
                try p.run()
                let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + 4, execute: killer)
                data = out.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit(); killer.cancel()
            } catch { err = "sprag bar 실행 실패: \(error.localizedDescription)" }
            let snap = try? JSONDecoder().decode(Snapshot.self, from: data)
            DispatchQueue.main.async {
                self.running = false
                self.sysCpu = self.machine.cpu() ?? self.sysCpu
                self.sysMemMb = self.machine.memUsedMb() ?? self.sysMemMb
                if let g = self.machine.gpu() { self.gpu = g.load; self.gpuMemMb = g.memMb }
                if snap == nil && detailed { self.detailOff = true; self.refresh(); return }  // an older CLI refuses the flag: carry on without it
                if let s = snap {
                    let cpu = Dictionary(s.sessions.map { ($0.pid, Model.raw($0)) }, uniquingKeysWith: { a, _ in a })
                    let mem = Dictionary(s.sessions.map { ($0.pid, $0.rssMb ?? 0) }, uniquingKeysWith: { a, _ in a })
                    self.readings.append(Reading(at: Date().timeIntervalSince1970, cpu: cpu, mem: mem)); if self.readings.count > 8 { self.readings.removeFirst() }
                    self.snap = s; self.failure = nil
                    if TRACE {
                        let rows = s.sessions.map { "\($0.pid):\(String(format: "%.1f", Model.raw($0)))/\(Int($0.rssMb ?? 0))>\(String(format: "%.1f", self.cpuOf($0)))/\(Int(self.memOf($0)))" }.joined(separator: " ")
                        print("POLL raw \(String(format: "%.1f", s.sessions.reduce(0) { $0 + Model.raw($1) }))% \(Int(s.sessions.reduce(0) { $0 + ($1.rssMb ?? 0) }))MB | shown \(String(format: "%.1f", self.share(nil)))% \(Int(self.mem(nil)))MB | order \(s.sessions.map { String($0.pid) }.joined(separator: ",")) | \(rows)"); fflush(stdout)
                    }
                } else { self.failure = err ?? "sprag bar 출력을 읽지 못했습니다" }
                let live = self.snap?.sessions ?? []
                let roots = Set(live.map { $0.pid })
                self.readCensus(live)
                self.readGpuUse(roots)
                var ups: [Int: Int] = [:]
                for r in live { if let p = parentPid(Int32(r.pid)), let up = sessionOf(p, roots.subtracting([r.pid])) { ups[r.pid] = up } }
                // A session started from another session's shell begins life with that session's marker, even when it was detached from its tree.
                for r in live where ups[r.pid] == nil {
                    if self.bornOf[r.pid] == nil { let o = claudeOrigin(Int32(r.pid)); self.bornOf[r.pid] = (o.sid, o.cpid) }
                    guard let from = self.bornOf[r.pid] else { continue }
                    if let cp = from.cpid, Int(cp) != r.pid, roots.contains(Int(cp)) { ups[r.pid] = Int(cp) }
                    else if let sid = from.sid, sid != r.sessionId, let up = live.first(where: { $0.sessionId == sid }) { ups[r.pid] = up.pid }
                }
                self.bornOf = self.bornOf.filter { roots.contains($0.key) }
                self.parentSession = ups
                var x = Sample()
                x.claudeCpu = self.share("claude") / 100; x.codexCpu = self.share("codex") / 100
                x.claudeMem = self.mem("claude") / RAM_MB; x.codexMem = self.mem("codex") / RAM_MB
                x.sysCpu = max(self.sysCpu ?? 0, x.claudeCpu + x.codexCpu); x.sysMem = max((self.sysMemMb ?? 0) / RAM_MB, x.claudeMem + x.codexMem)
                x.leftCpu = self.leftover.cpu; x.leftMem = self.leftover.mem / RAM_MB
                x.claudeGpu = min(1, live.filter { $0.agent != "codex" }.reduce(0) { $0 + (self.gpuBySession[$1.pid] ?? 0) })
                x.codexGpu = min(1 - x.claudeGpu, live.filter { $0.agent == "codex" }.reduce(0) { $0 + (self.gpuBySession[$1.pid] ?? 0) })
                x.gpu = max(self.gpu ?? 0, x.claudeGpu + x.codexGpu)
                x.at = Date().timeIntervalSince1970; x.cost = self.snap?.totals.costUsd ?? 0
                self.samples.append(x); if self.samples.count > 60 { self.samples.removeFirst() }
                if let s = snap {
                    for r in s.sessions {
                        var a = self.hist[r.pid] ?? []
                        a.append(Hist(at: x.at, cpu: self.cpuOf(r), mem: self.memOf(r), gpu: self.gpuBySession[r.pid] ?? 0)); if a.count > 60 { a.removeFirst() }
                        self.hist[r.pid] = a
                    }
                    self.hist = self.hist.filter { k, _ in s.sessions.contains { $0.pid == k } }
                }
                self.onUpdate?()
            }
        }
    }
}

/** The settings page. It only ever runs commands the CLI already has; nothing here writes a file itself. */
final class Prefs: ObservableObject {
    @Published var s: Settings?
    @Published var samples: [Int: String] = [:]   // display level -> what the statusline looks like at that level
    @Published var pendingCompact: Int?           // a compact window value waiting for the second click
    /** Called when the settings page opens. */
    func open() { note = ""; failed = false; pendingCompact = nil; load(resetDraft: true); loadSamples() }
    /** The CLI's own demo render at each level, with the stored label style, so a level is shown and not described. */
    func loadSamples() {
        for n in 0...3 {
            sprag(["--statusline", "--demo", "healthy", "--compact-level", String(n), "--no-color", "--columns", "200"], timeout: 6) { code, out, _ in
                let t = stripAnsi(out).trimmingCharacters(in: .whitespacesAndNewlines)
                if code == 0, !t.isEmpty { self.samples[n] = t; RELAYOUT() }
            }
        }
    }
    @Published var working = false
    @Published var note = ""
    @Published var failed = false
    @Published var nameDraft = ""
    var onLayout: (() -> Void)?
    func load(resetDraft: Bool = false, then: (() -> Void)? = nil) {
        sprag(["bar", "--settings"], timeout: 6) { _, out, _ in
            if let v = try? JSONDecoder().decode(Settings.self, from: Data(out.utf8)) {
                self.s = v
                if resetDraft { self.nameDraft = v.team.displayName ?? "" }
            } else { self.note = "설정을 읽지 못했습니다"; self.failed = true }
            self.onLayout?(); then?()
        }
    }
    /** Run one settings command, show its first line of output, then read every setting back from the CLI. */
    func apply(_ args: [String], say: String? = nil, resetDraft: Bool = false, then: (() -> Void)? = nil, _ guess: (inout Settings) -> Void = { _ in }) {
        if working { return }
        working = true
        if var v = s { guess(&v); s = v }  // the control moves at once; the reload below is what counts
        sprag(args, timeout: 25) { code, out, err in
            self.working = false
            self.failed = code != 0
            self.note = code == 0 ? (say ?? firstLine(out)) : (firstLine(err).isEmpty ? (firstLine(out).isEmpty ? "실패했습니다 (종료 코드 \(code))" : firstLine(out)) : firstLine(err))
            self.load(resetDraft: resetDraft, then: then)
        }
    }
    func setRouting(_ on: Bool, then: (() -> Void)? = nil) { apply(["routing", on ? "on" : "off"], then: then) { $0.routing.enabled = on } }
    func setRelax(_ on: Bool, then: (() -> Void)? = nil) { apply(on ? ["routing", "relax"] : ["routing", "relax", "off"], then: then) { $0.routing.relaxed = on } }
    func setLevel(_ n: Int, then: (() -> Void)? = nil) { apply(["mode", "compact=\(n)"], say: "상태줄 표시 단계를 \(n)로 바꿨습니다. 다음 갱신부터 적용됩니다", then: then) { $0.statusline.compact = n } }
    func setLabels(_ v: String, then: (() -> Void)? = nil) { apply(["mode", v], say: "상태줄 라벨을 바꿨습니다. 다음 갱신부터 적용됩니다", then: { self.loadSamples(); then?() }) { $0.statusline.labels = v } }
    /** Writes the global settings file for every model, so the page asks twice before calling this. */
    func setCompact(_ n: Int, then: (() -> Void)? = nil) {
        pendingCompact = nil
        apply(["compact-window", "set", "--global", "--all-models", "--value", "\(n / 1000)k"], say: "자동 압축 시점을 \(n / 1000)k로 바꿨습니다. 새 세션부터 적용됩니다", then: then) { $0.compactWindow?.value = Double(n) }
    }
    func setCompactWarn(_ on: Bool, then: (() -> Void)? = nil) { apply(["compact-window", on ? "on" : "off"], say: on ? "자동 압축 알림을 켰습니다" : "자동 압축 알림을 껐습니다", then: then) { $0.compactWindow?.warn = on } }
    func setTimer(_ on: Bool, then: (() -> Void)? = nil) { apply(["mode", on ? "timer" : "no-timer"], say: on ? "캐시 타이머를 켰습니다" : "캐시 타이머를 껐습니다", then: then) { $0.statusline.timer = on } }
    func setLanguage(_ v: String, then: (() -> Void)? = nil) { apply(["mode", "lang=\(v)"], say: v == "ko" ? "안내문 언어를 한국어로 바꿨습니다" : "안내문 언어를 영어로 바꿨습니다", then: then) { $0.language = v } }
    var nameChanged: Bool { let d = nameDraft.trimmingCharacters(in: .whitespaces); return !d.isEmpty && d != (s?.team.displayName ?? "") }
    func rename() { if nameChanged { apply(["team", "name", nameDraft.trimmingCharacters(in: .whitespaces)], resetDraft: true) } }
    func openTown() { apply(["team", "town"], say: "브라우저에서 타운을 열었습니다") }
}

/** The rules page. Like the settings page it only runs commands the CLI already has. */
final class RuleBook: ObservableObject {
    @Published var data: Rules?
    @Published var working = false
    @Published var note = ""
    @Published var failed = false
    @Published var open: Set<String> = []     // groups that are unfolded
    @Published var expanded: String?          // the rule showing its full text and buttons
    @Published var confirm: String?           // the rule whose removal waits for the second click
    @Published var drafts: [String: String] = [:]
    func load(then: (() -> Void)? = nil) {
        sprag(["bar", "--rules"], timeout: 8) { _, out, _ in
            if let v = try? JSONDecoder().decode(Rules.self, from: Data(out.utf8)) { self.data = v } else { self.note = "규칙을 읽지 못했습니다"; self.failed = true }
            RELAYOUT(); then?()
        }
    }
    private func run(_ args: [String], cwd: String? = nil, say: String, then: (() -> Void)? = nil) {
        working = true
        sprag(args, timeout: 25, cwd: cwd) { code, out, err in
            self.working = false; self.confirm = nil; self.expanded = nil
            self.failed = code != 0
            self.note = code == 0 ? say : (firstLine(err).isEmpty ? (firstLine(out).isEmpty ? "실패했습니다 (종료 코드 \(code))" : firstLine(out)) : firstLine(err))
            self.load(then: then)
        }
    }
    private func refuse(_ then: (() -> Void)?) { working = false; failed = true; confirm = nil; note = "목록이 그사이 바뀌어 지우지 않았습니다. 다시 확인해 주십시오"; RELAYOUT(); then?() }
    /** A rule is removed by its number, and the number is a position in a file that may have changed since it was shown: read the list again first. */
    func removeRatchet(scope: String, root: String?, index: Int, text: String, then: (() -> Void)? = nil) {
        if working { return }
        working = true
        load {
            let now = scope == "global" ? self.data?.global.rules : self.data?.projects.first { $0.root == root }?.rules
            guard now?.first(where: { $0.index == index })?.text == text else { self.refuse(then); return }
            self.run(["harness", "rm", scope == "global" ? "--global" : "--project", String(index)], cwd: root, say: "규칙을 지웠습니다. 지우기 전 내용은 같은 폴더의 ratchet.md.bak 에 있습니다", then: then)
        }
    }
    func addRatchet(scope: String, root: String?, key: String, text: String, then: (() -> Void)? = nil) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " ")
        if working || t.count < 8 || !t.contains(" ") { return }  // a bare number or R<n> would be read as a candidate id
        run(["harness", "promote", t, scope == "global" ? "--global" : "--project"], cwd: root, say: "규칙을 추가했습니다. 새 세션부터 적용됩니다") { self.drafts[key] = ""; then?() }
    }
    func skipPreset(_ id: String, then: (() -> Void)? = nil) { if !working { run(["seed", "skip", id], say: "프리셋을 뺐습니다. 다시 권하지 않습니다", then: then) } }
    func acceptPreset(_ id: String, then: (() -> Void)? = nil) { if !working { run(["seed", "accept", id, "--global"], say: "프리셋을 전역으로 등록했습니다", then: then) } }
    func removeModel(index: Int, text: String, then: (() -> Void)? = nil) {
        if working { return }
        working = true
        load {
            guard self.data?.model.rules.first(where: { $0.index == index })?.text == text else { self.refuse(then); return }
            self.run(["route-scan", "rules", "rm", String(index)], say: "모델 위임 룰을 지웠습니다", then: then)
        }
    }
}

// ---------- the runner: the member's town animal, drawn in code as a template image ----------
// Thirty species and the ghost, one per grade of Sprag Town (GRADES in site/assets/scene/office-scene.js). They share a
// whole-body gallop (the spine gathers and stretches, the body pitches and bounces, the tail trails) in a three-quarter
// view with two eyes; birds and the dragon fly, the frog hops, the duck and chick walk, the ghost floats.
let RUNNER_SCALE: CGFloat = 0.9
/** The species to draw: the member's town grade; without one (no team, nothing uploaded) the ghost. */
func runnerSpecies(_ grade: String?) -> Sp { SPECIES.first { $0.id == grade } ?? SPECIES.first { $0.id == "ghost" }! }
struct Key { let flex, pitch, lift: Double; let fn, ff, hn, hf: (Double, Double) }
// flex: +1 stretched out, -1 gathered (back arched). pitch: degrees, + nose up. lift: units above the standing height.
let GAL: [Key] = [
    Key(flex: 1.0, pitch: 0, lift: 1.9, fn: (72, 84), ff: (60, 74), hn: (-74, -88), hf: (-60, -78)),     // flight, stretched
    Key(flex: 0.55, pitch: -7, lift: 0.7, fn: (36, 14), ff: (52, 36), hn: (-62, -84), hf: (-48, -72)),    // front lands
    Key(flex: 0.0, pitch: -11, lift: -0.4, fn: (2, -16), ff: (20, 4), hn: (-26, -62), hf: (-40, -76)),     // weight over the front
    Key(flex: -0.6, pitch: -5, lift: 0.3, fn: (-30, -58), ff: (-16, -44), hn: (24, 4), hf: (8, -14)),      // front pushes, hind swing under
    Key(flex: -1.0, pitch: 3, lift: 1.4, fn: (-44, -88), ff: (-30, -76), hn: (52, 30), hf: (40, 16)),      // gathered flight
    Key(flex: -0.55, pitch: 9, lift: 0.3, fn: (8, -50), ff: (24, -30), hn: (30, 8), hf: (16, -8)),         // hind lands
    Key(flex: 0.0, pitch: 11, lift: -0.3, fn: (44, 18), ff: (56, 34), hn: (0, -14), hf: (-16, -30)),       // hind carry
    Key(flex: 0.6, pitch: 6, lift: 0.9, fn: (66, 58), ff: (62, 64), hn: (-44, -60), hf: (-56, -70)),       // push off
]
let STAND2 = Key(flex: 0, pitch: 0, lift: 0, fn: (4, -2), ff: (-6, 3), hn: (-8, 6), hf: (5, 12))

enum Ear { case pricked, round, long, cat, tiny, floppy, side, mouse, horse, sheep, pig, none }
enum Tail { case curl, long, bushy, stub, tuft, thin, curly, ringed, squirrel, thinLong, hang, flow, wag, short, monkey, rope, none }
struct Sp {
    let id: String, label: String
    var ear: Ear = .pricked, tail: Tail = .long
    var len = 9.6, chest = 3.4, hip = 3.0          // spine length, torso radii
    var legF = 7.4, legH = 7.6                     // leg lengths
    var head = 2.9, snout = 3.0, snoutH = 1.0      // head radius, muzzle length and depth
    var neckX = 3.6, neckY = 4.4                   // head offset from the shoulder
    var flexAmp = 1.0, liftAmp = 1.0, pitchAmp = 1.0
    var mane = false, legW = 1.0, waddle = false, fly = 0, hump = false, eyeK = 1.0, x: Set<String> = [], kind = 0, eyeDx: Double = 0
}
let SPECIES: [Sp] = [
    Sp(id: "husky", label: "허스키", ear: .pricked, tail: .curl),
    Sp(id: "cat", label: "고양이", ear: .cat, tail: .long, len: 10.4, chest: 3.0, hip: 2.8, legF: 7.0, legH: 7.4, head: 2.7, snout: 1.2, snoutH: 1.4, neckX: 3.2, neckY: 4.0, flexAmp: 1.25, liftAmp: 1.15, pitchAmp: 1.1, legW: 0.9),
    Sp(id: "fox", label: "여우", ear: .pricked, tail: .bushy, len: 10.0, chest: 3.1, hip: 2.8, legF: 7.0, legH: 7.2, head: 2.6, snout: 3.6, snoutH: 0.8, flexAmp: 1.1, legW: 0.9),
    Sp(id: "cheetah", label: "치타", ear: .round, tail: .long, len: 11.4, chest: 3.0, hip: 2.5, legF: 8.2, legH: 8.4, head: 2.3, snout: 1.4, snoutH: 1.2, neckX: 3.0, neckY: 3.4, flexAmp: 1.45, liftAmp: 1.1, pitchAmp: 1.0, legW: 0.85),
    Sp(id: "lion", label: "사자", ear: .round, tail: .tuft, len: 10.6, chest: 3.8, hip: 3.0, legF: 7.4, legH: 7.6, head: 2.5, snout: 1.8, snoutH: 1.6, flexAmp: 0.9, liftAmp: 0.9, mane: true, legW: 1.1),
    Sp(id: "rabbit", label: "토끼", ear: .long, tail: .stub, len: 8.4, chest: 3.0, hip: 3.6, legF: 5.0, legH: 8.0, head: 2.7, snout: 1.0, snoutH: 1.6, neckX: 3.0, neckY: 3.6, flexAmp: 1.4, liftAmp: 1.5, pitchAmp: 1.6, legW: 0.95),
    Sp(id: "bear", label: "곰", ear: .round, tail: .stub, len: 12.6, chest: 3.5, hip: 3.3, legF: 10.0, legH: 10.0, head: 2.5, snout: 3.2, snoutH: 1.3, neckX: 4.4, neckY: 0.9, flexAmp: 0.6, liftAmp: 0.6, pitchAmp: 0.9, legW: 1.5, hump: true, eyeK: 0.85),
    Sp(id: "penguin", label: "펭귄", waddle: true),
    Sp(id: "eagle", label: "독수리", fly: 1),
    Sp(id: "owl", label: "부엉이", fly: 2),
    Sp(id: "dragon", label: "용", fly: 3),
    Sp(id: "unicorn", label: "유니콘", ear: .horse, tail: .flow, len: 11.0, chest: 3.1, hip: 2.9, legF: 9.2, legH: 9.2, head: 2.2, snout: 3.2, snoutH: 1.2, neckX: 4.2, neckY: 4.2, flexAmp: 1.0, liftAmp: 1.1, legW: 0.95, x: ["horn", "neckmane", "wings"]),
    Sp(id: "tiger", label: "호랑이", ear: .round, tail: .long, len: 11.0, chest: 3.6, hip: 3.1, legF: 7.6, legH: 7.8, head: 2.6, snout: 1.7, snoutH: 1.5, flexAmp: 1.1, legW: 1.1, x: ["stripes"]),
    Sp(id: "wolf", label: "늑대", ear: .pricked, tail: .hang, len: 10.8, chest: 3.3, hip: 2.8, legF: 8.4, legH: 8.6, head: 2.6, snout: 3.6, snoutH: 0.95, flexAmp: 1.15, legW: 0.95),
    Sp(id: "panda", label: "판다", ear: .round, tail: .stub, len: 9.6, chest: 4.0, hip: 3.8, legF: 6.6, legH: 6.6, head: 3.0, snout: 1.2, snoutH: 1.6, neckX: 3.4, neckY: 2.8, flexAmp: 0.6, liftAmp: 0.6, pitchAmp: 1.2, legW: 1.4, x: ["panda"]),
    Sp(id: "koala", label: "코알라", ear: .side, tail: .none, len: 8.6, chest: 3.6, hip: 3.6, legF: 6.0, legH: 6.0, head: 3.1, snout: 0, snoutH: 1.0, neckX: 3.2, neckY: 3.2, flexAmp: 0.7, liftAmp: 0.8, legW: 1.3, x: ["koalanose"]),
    Sp(id: "raccoon", label: "너구리", ear: .cat, tail: .ringed, len: 9.6, chest: 3.1, hip: 3.1, legF: 6.4, legH: 6.6, head: 2.6, snout: 2.4, snoutH: 0.9, flexAmp: 1.0, legW: 1.0),
    Sp(id: "dog", label: "강아지", ear: .floppy, tail: .wag, len: 9.0, chest: 3.2, hip: 2.9, legF: 6.8, legH: 7.0, head: 2.8, snout: 2.9, snoutH: 1.2, flexAmp: 1.0, liftAmp: 1.1, legW: 1.0),
    Sp(id: "monkey", label: "원숭이", ear: .side, tail: .monkey, len: 9.0, chest: 3.0, hip: 2.8, legF: 8.6, legH: 7.4, head: 2.8, snout: 1.3, snoutH: 1.5, flexAmp: 1.1, liftAmp: 1.2, legW: 0.95),
    Sp(id: "deer", label: "사슴", ear: .horse, tail: .short, len: 10.4, chest: 3.0, hip: 2.8, legF: 11.0, legH: 11.4, head: 2.3, snout: 2.8, snoutH: 1.0, neckX: 3.6, neckY: 5.2, flexAmp: 1.2, liftAmp: 1.35, legW: 0.8, x: ["antlers"]),
    Sp(id: "elephant", label: "코끼리", ear: .none, tail: .rope, len: 11.2, chest: 4.5, hip: 4.2, legF: 7.4, legH: 7.4, head: 3.1, snout: 0, snoutH: 1.0, neckX: 3.2, neckY: 2.6, flexAmp: 0.4, liftAmp: 0.45, pitchAmp: 0.8, legW: 1.8, x: ["trunk"], eyeDx: 0.18),
    Sp(id: "pig", label: "돼지", ear: .pig, tail: .curly, len: 10.0, chest: 3.6, hip: 3.6, legF: 5.6, legH: 5.6, head: 2.8, snout: 0, snoutH: 1.0, neckX: 3.4, neckY: 2.6, flexAmp: 0.6, liftAmp: 0.7, legW: 1.2, x: ["pigsnout"]),
    Sp(id: "sheep", label: "양", ear: .sheep, tail: .stub, len: 9.6, chest: 3.6, hip: 3.6, legF: 9.2, legH: 9.2, head: 2.2, snout: 1.8, snoutH: 1.3, neckX: 4.4, neckY: 3.0, flexAmp: 0.7, liftAmp: 0.9, legW: 0.75, x: ["wool"]),
    Sp(id: "hedgehog", label: "고슴도치", ear: .round, tail: .none, len: 8.4, chest: 3.0, hip: 3.0, legF: 4.2, legH: 4.2, head: 2.3, snout: 2.8, snoutH: 0.8, neckX: 3.6, neckY: 1.6, flexAmp: 0.4, liftAmp: 0.4, legW: 0.9, x: ["spikes"]),
    Sp(id: "squirrel", label: "다람쥐", ear: .cat, tail: .squirrel, len: 8.0, chest: 2.6, hip: 2.9, legF: 5.0, legH: 7.0, head: 2.5, snout: 1.2, snoutH: 1.2, neckX: 3.0, neckY: 3.4, flexAmp: 1.3, liftAmp: 1.35, pitchAmp: 1.4, legW: 0.85),
    Sp(id: "hamster", label: "햄스터", ear: .round, tail: .none, len: 7.6, chest: 3.6, hip: 3.8, legF: 3.6, legH: 3.6, head: 3.0, snout: 1.0, snoutH: 1.5, neckX: 2.6, neckY: 2.4, flexAmp: 0.3, liftAmp: 0.45, legW: 1.0),
    Sp(id: "mouse", label: "생쥐", ear: .mouse, tail: .thinLong, len: 8.0, chest: 2.6, hip: 2.8, legF: 4.6, legH: 4.8, head: 2.4, snout: 2.6, snoutH: 0.8, neckX: 3.2, neckY: 2.4, flexAmp: 0.8, liftAmp: 0.8, legW: 0.8),
    Sp(id: "frog", label: "개구리", kind: 4),
    Sp(id: "duck", label: "오리", kind: 5),
    Sp(id: "chick", label: "병아리", kind: 6),
    Sp(id: "ghost", label: "유령", kind: 7),
]

func rot(_ p: NSPoint, _ c: NSPoint, _ a: CGFloat) -> NSPoint {
    let dx = p.x - c.x, dy = p.y - c.y
    return NSPoint(x: c.x + dx * cos(a) - dy * sin(a), y: c.y + dx * sin(a) + dy * cos(a))
}
func line2(_ a: NSPoint, _ b: NSPoint, _ w: CGFloat) { let q = NSBezierPath(); q.lineWidth = w; q.lineCapStyle = .round; q.move(to: a); q.line(to: b); q.stroke() }
func oval(_ c: NSPoint, _ rx: CGFloat, _ ry: CGFloat) { NSBezierPath(ovalIn: NSRect(x: c.x - rx, y: c.y - ry, width: rx * 2, height: ry * 2)).fill() }

func runner(_ sp: Sp, frame: Int, idle: Bool) -> NSImage {
    let size = NSSize(width: 31 * RUNNER_SCALE, height: 21.4 * RUNNER_SCALE)
    // The drawing is its own function. Swift 6.0 type-checks a multi-statement closure together with the call that
    // takes it, and this body inside NSImage(size:flipped:) gave up with "unable to type-check this expression in
    // reasonable time" (#22). A function body is checked statement by statement.
    let img = NSImage(size: size, flipped: false) { _ in drawRunner(sp, frame: frame, idle: idle); return true }
    img.isTemplate = true
    return img
}

func drawRunner(_ sp: Sp, frame: Int, idle: Bool) {
    let t = NSAffineTransform(); t.scale(by: RUNNER_SCALE); t.concat()
    NSColor.black.setFill(); NSColor.black.setStroke()
    if sp.waddle { penguin(frame: frame, idle: idle); return }
    if sp.fly > 0 { flyer(sp, frame: frame, idle: idle); return }
    if sp.kind == 4 { frog(frame: frame, idle: idle); return }
    if sp.kind == 5 || sp.kind == 6 { biped(chick: sp.kind == 6, frame: frame, idle: idle); return }
    if sp.kind == 7 { ghost(frame: frame, idle: idle); return }
    let k = idle ? STAND2 : GAL[frame % GAL.count]
    let n = GAL.count, ph = 2 * CGFloat.pi * CGFloat(frame % n) / CGFloat(n)
    let flex = CGFloat(k.flex * sp.flexAmp), lift = CGFloat(k.lift * sp.liftAmp) * 1.2
    let pitch = CGFloat(k.pitch * sp.pitchAmp) * .pi / 180
    let ground: CGFloat = 1.3
    let airborne = sp.x.contains("wings") && !idle      // runs on air: the hooves never touch the ground
    let standY: CGFloat = ground + CGFloat(sp.legH) * LEGK * 0.86 + 0.9
    let bob: CGFloat = idle ? 0.12 * sin(ph) : 0
    let hover: CGFloat = airborne ? 1.2 : 0
    let y0: CGFloat = standY + lift + bob + hover
    let c = NSPoint(x: 14.6, y: y0)
    let half = CGFloat(sp.len) * BODYK / 2 * (1 + 0.17 * flex)
    let arch = flex < 0 ? -flex * 1.5 : -flex * 0.3   // gathered: the back humps up; stretched: nearly flat
    let H = rot(NSPoint(x: c.x - half, y: y0), c, pitch), S = rot(NSPoint(x: c.x + half, y: y0), c, pitch)
    let M = rot(NSPoint(x: c.x, y: y0 + arch * 2), c, pitch)
    func leg(_ joint: NSPoint, _ a: (Double, Double), _ len: CGFloat, _ near: Bool) {
        let a1 = CGFloat(a.0) * .pi / 180, a2 = CGFloat(a.1) * .pi / 180
        let u = len * 0.5, l = len * 0.52
        let knee = NSPoint(x: joint.x + sin(a1) * u, y: joint.y - cos(a1) * u)
        var foot = NSPoint(x: knee.x + sin(a2) * l, y: knee.y - cos(a2) * l)
        foot.y = max(foot.y, airborne ? 1.1 : ground)
        let w = CGFloat(sp.legW) * (near ? 1 : 0.86)
        taper(joint, knee, 3.6 * w, 2.0 * w); taper(knee, foot, 2.0 * w, 1.35 * w)
        oval(NSPoint(x: foot.x + 0.35, y: foot.y + 0.05), 1.0 * w, 0.72 * w)
    }
    let sh = NSPoint(x: S.x - 0.4, y: S.y - CGFloat(sp.chest) * 0.35), hp = NSPoint(x: H.x + 0.5, y: H.y - CGFloat(sp.hip) * 0.3)
    // far legs
    leg(sh, k.ff, CGFloat(sp.legF) * LEGK, false); leg(hp, k.hf, CGFloat(sp.legH) * LEGK, false)
    // tail, trailing the body by a quarter stride
    let lag = sin(ph - .pi / 2), tb = rot(NSPoint(x: c.x - half - 0.6, y: y0 + 0.8), c, pitch)
    let tail = NSBezierPath(); tail.lineCapStyle = .round; tail.lineJoinStyle = .round
    switch sp.tail {
    case .curl:
        tail.lineWidth = 3.1
        tail.move(to: tb)
        tail.curve(to: NSPoint(x: tb.x + 1.0 + flex * 0.4, y: tb.y + 5.2 - flex * 0.6), controlPoint1: NSPoint(x: tb.x - 5.0, y: tb.y + 0.4), controlPoint2: NSPoint(x: tb.x - 5.0 + lag, y: tb.y + 6.2))
        tail.stroke()
    case .long, .tuft, .thin:
        tail.lineWidth = sp.tail == .tuft ? 1.4 : 1.6
        let end = NSPoint(x: tb.x - 7.0 + abs(flex) * 0.6, y: tb.y + 1.2 - flex * 2.4 + lag * 1.6)
        tail.move(to: tb)
        tail.curve(to: end, controlPoint1: NSPoint(x: tb.x - 2.6, y: tb.y - 1.4 - lag), controlPoint2: NSPoint(x: end.x + 2.6, y: end.y - 2.2 + lag * 1.4))
        tail.stroke()
        if sp.tail == .tuft { oval(end, 1.3, 1.1) }
    case .bushy:
        let end = NSPoint(x: tb.x - 7.2, y: tb.y - 0.4 - flex * 1.6 + lag * 1.2)
        let b = NSBezierPath()
        b.move(to: NSPoint(x: tb.x + 0.4, y: tb.y + 1.2))
        b.curve(to: end, controlPoint1: NSPoint(x: tb.x - 2.6, y: tb.y + 2.4 + lag * 0.6), controlPoint2: NSPoint(x: end.x + 2.4, y: end.y + 2.2))
        b.curve(to: NSPoint(x: tb.x + 0.4, y: tb.y - 1.2), controlPoint1: NSPoint(x: end.x + 1.6, y: end.y - 1.8), controlPoint2: NSPoint(x: tb.x - 2.8, y: tb.y - 2.0 + lag * 0.6))
        b.close(); b.fill()
    case .stub:
        oval(NSPoint(x: tb.x + 0.6, y: tb.y + 0.6), 1.5, 1.4)
    case .none: break
    case .curly:   // a pig's corkscrew
        let cc = NSPoint(x: tb.x - 1.2, y: tb.y + 1.0 + lag * 0.3), t = NSBezierPath(); t.lineWidth = 0.85; t.lineCapStyle = .round
        t.move(to: NSPoint(x: tb.x + 0.2, y: tb.y + 0.2))
        t.appendArc(withCenter: cc, radius: 0.95, startAngle: -20, endAngle: 300, clockwise: false); t.stroke()
    case .ringed, .hang:
        let end = sp.tail == .hang ? NSPoint(x: tb.x - 5.6, y: tb.y - 3.6 + lag * 0.9 - flex * 0.6) : NSPoint(x: tb.x - 7.0, y: tb.y + 0.4 - flex * 1.4 + lag * 1.2)
        let b = NSBezierPath()
        b.move(to: NSPoint(x: tb.x + 0.4, y: tb.y + 1.2))
        b.curve(to: end, controlPoint1: NSPoint(x: tb.x - 2.4, y: tb.y + 1.6 + lag * 0.5), controlPoint2: NSPoint(x: end.x + 2.0, y: end.y + 2.0))
        b.curve(to: NSPoint(x: tb.x + 0.4, y: tb.y - 1.2), controlPoint1: NSPoint(x: end.x + 1.4, y: end.y - 1.6), controlPoint2: NSPoint(x: tb.x - 2.6, y: tb.y - 1.8 + lag * 0.5))
        b.close(); b.fill()
        if sp.tail == .ringed {   // dark and pale rings: two gaps cut across the tail
            NSGraphicsContext.current?.compositingOperation = .clear
            for t in [0.42, 0.7] as [CGFloat] {
                let m = NSPoint(x: tb.x + (end.x - tb.x) * t, y: tb.y + (end.y - tb.y) * t + 0.3)
                line2(NSPoint(x: m.x + 0.5, y: m.y + 2.2), NSPoint(x: m.x - 0.5, y: m.y - 2.2), 0.6)
            }
            NSGraphicsContext.current?.compositingOperation = .sourceOver
        }
    case .squirrel:   // a big plume carried up over the back, its tip curling forward
        let t = NSBezierPath(); t.lineWidth = 3.6; t.lineCapStyle = .round
        let tip = NSPoint(x: tb.x + 0.8 + lag * 0.4, y: tb.y + 8.6 - flex * 0.6)
        t.move(to: tb); t.curve(to: tip, controlPoint1: NSPoint(x: tb.x - 5.2, y: tb.y + 1.4), controlPoint2: NSPoint(x: tb.x - 4.4 + lag * 0.5, y: tb.y + 9.4)); t.stroke()
        oval(tip, 1.8, 1.6)
    case .thinLong, .monkey:
        tail.lineWidth = sp.tail == .monkey ? 1.1 : 0.75
        let end = NSPoint(x: tb.x - 7.4, y: tb.y + (sp.tail == .monkey ? 4.2 : 0.2) - flex * 1.2 + lag * 1.4)
        tail.move(to: tb)
        tail.curve(to: end, controlPoint1: NSPoint(x: tb.x - 2.8, y: tb.y - 1.6 - lag), controlPoint2: NSPoint(x: end.x + 2.6, y: end.y - 2.4 + lag))
        if sp.tail == .monkey { tail.appendArc(withCenter: NSPoint(x: end.x + 0.9, y: end.y), radius: 0.9, startAngle: 180, endAngle: 450, clockwise: false) }
        tail.stroke()
    case .flow:   // a horse's tail: a few strands streaming back
        for (dy, w) in [(0.0, 1.5), (-0.9, 1.1), (0.8, 1.0)] as [(CGFloat, CGFloat)] {
            let t = NSBezierPath(); t.lineWidth = w; t.lineCapStyle = .round
            let end = NSPoint(x: tb.x - 6.4, y: tb.y - 2.2 + dy - flex * 1.2 + lag * 1.4)
            t.move(to: NSPoint(x: tb.x, y: tb.y + 0.6)); t.curve(to: end, controlPoint1: NSPoint(x: tb.x - 2.4, y: tb.y + 1.4 + dy), controlPoint2: NSPoint(x: end.x + 2.6, y: end.y + 1.2 - lag)); t.stroke()
        }
    case .wag:     // a puppy's short tail, held up and wagging
        line2(NSPoint(x: tb.x + 0.3, y: tb.y + 0.4), NSPoint(x: tb.x - 1.8 + lag * 0.9, y: tb.y + 3.0), 1.4)
    case .short:
        oval(NSPoint(x: tb.x - 0.4, y: tb.y + 1.2), 0.9, 1.3)
    case .rope:    // an elephant's thin tail with a tuft
        let e = NSPoint(x: tb.x - 1.6 + lag * 0.5, y: tb.y - 2.8)
        line2(tb, e, 0.7); oval(e, 0.6, 0.8)
    }
    // wings beat once a stride, the downstroke as the body rises; the far wing goes behind the body
    let wingFlap: CGFloat = idle ? -0.15 : sin(ph + 0.6)
    let wingRoot = rot(NSPoint(x: c.x + half - 1.8, y: y0 + CGFloat(sp.chest) * 0.75), c, pitch)
    if sp.x.contains("wings") { featherWing(NSPoint(x: wingRoot.x + 0.6, y: wingRoot.y + 0.3), flap: idle ? -0.15 : sin(ph + 0.25), span: idle ? 5.5 : 7.6, near: false) }
    // torso: hip and chest masses joined along a spine that bends
    let sp2 = NSBezierPath(); sp2.lineWidth = CGFloat(min(sp.chest, sp.hip)) * 2.15; sp2.lineCapStyle = .round
    sp2.move(to: H); sp2.curve(to: S, controlPoint1: M, controlPoint2: M); sp2.stroke()
    let sq = 1 - 0.09 * max(0, -lift)            // squashed a little on landing
    oval(NSPoint(x: H.x + 0.3, y: H.y), CGFloat(sp.hip) * (2 - sq), CGFloat(sp.hip) * 0.95 * sq)
    oval(NSPoint(x: S.x - 0.2, y: S.y - 0.25), CGFloat(sp.chest) * (2 - sq), CGFloat(sp.chest) * sq)
    if sp.hump { oval(rot(NSPoint(x: S.x - 1.4, y: S.y + CGFloat(sp.chest) * 0.62), S, pitch), CGFloat(sp.chest) * 0.78, CGFloat(sp.chest) * 0.62) }
    let br = CGFloat(min(sp.chest, sp.hip)) * 1.07
    func along(_ t: CGFloat) -> NSPoint {   // a point on the spine, t = 0 at the hip and 1 at the shoulder
        let u = 1 - t; return NSPoint(x: u * u * u * H.x + 3 * u * u * t * M.x + 3 * u * t * t * M.x + t * t * t * S.x, y: u * u * u * H.y + 3 * u * u * t * M.y + 3 * u * t * t * M.y + t * t * t * S.y)
    }
    if sp.x.contains("wool") {   // a white fleece with a scalloped outline: the puffs drawn dark, then hollowed out
        leg(sh, k.fn, CGFloat(sp.legF) * LEGK, true); leg(hp, k.hn, CGFloat(sp.legH) * LEGK, true)   // under the fleece
        var puffs: [(NSPoint, CGFloat)] = []
        for i in 0...5 { let p = along(CGFloat(i) / 5); puffs.append((NSPoint(x: p.x, y: p.y + br * 0.8), br * 0.62)); puffs.append((NSPoint(x: p.x, y: p.y - br * 0.55), br * 0.58)) }
        puffs.append((NSPoint(x: H.x - br * 0.8, y: H.y + 0.2), br * 0.62)); puffs.append((NSPoint(x: S.x + br * 0.55, y: S.y + br * 0.35), br * 0.6))
        for (c3, r) in puffs { oval(c3, r, r) }
        oval(along(0.5), br * 1.6, br * 1.1)
        NSGraphicsContext.current?.compositingOperation = .clear
        for (c3, r) in puffs { oval(c3, r - 0.75, r - 0.75) }
        oval(along(0.5), br * 1.6 - 0.75, br * 1.1 - 0.75)
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }
    if sp.x.contains("spikes") {  // a hedgehog's coat: spines over the back, pointing back
        for i in 0..<10 {
            let t = 0.05 + CGFloat(i) / 10, p = along(t), up = br * (0.6 + 0.4 * sin(t * .pi))
            let b0 = NSPoint(x: p.x - 0.8, y: p.y + up * 0.7), b1 = NSPoint(x: p.x + 0.8, y: p.y + up * 0.75)
            let tip = NSPoint(x: p.x - 2.6 - lag * 0.2, y: p.y + up + 2.8)
            let sp3 = NSBezierPath(); sp3.move(to: b0); sp3.line(to: tip); sp3.line(to: b1); sp3.close(); sp3.fill()
        }
        for i in 0..<3 { let p = along(0.02); let sp3 = NSBezierPath(); sp3.move(to: NSPoint(x: p.x - 0.4, y: p.y + CGFloat(i) - 0.6)); sp3.line(to: NSPoint(x: p.x - br - 1.6, y: p.y + CGFloat(i) * 1.2 - 0.6)); sp3.line(to: NSPoint(x: p.x - 0.4, y: p.y + CGFloat(i) + 0.4)); sp3.close(); sp3.fill() }
    }
    if sp.x.contains("stripes") {
        NSGraphicsContext.current?.compositingOperation = .clear
        // a tiger's stripes, cut across the back
        for t in [0.12, 0.32, 0.52, 0.72] as [CGFloat] { let p = along(t); line2(NSPoint(x: p.x - 0.4, y: p.y + br * 1.05), NSPoint(x: p.x + 0.4, y: p.y + br * 0.15), 0.55) }
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }
    if sp.x.contains("wings") { featherWing(wingRoot, flap: wingFlap, span: idle ? 6.0 : 9.0, near: true) }
    // neck and head, turned three-quarters toward the viewer so both eyes show; the head stays steadier than the body
    let hpitch = pitch * 0.35, hr = CGFloat(sp.head) * HEADK
    let hc = NSPoint(x: S.x + CGFloat(sp.neckX) * 0.62 * cos(pitch) - CGFloat(sp.neckY) * 0.4 * sin(pitch),
                     y: S.y + CGFloat(sp.neckY) * 0.62 - lift * 0.3 + CGFloat(sp.neckX) * 0.8 * sin(pitch))
    line2(NSPoint(x: S.x + 0.4, y: S.y + 0.4), hc, hr * 1.3)
    if sp.mane {
        lionMane(hc, hr, sweep: idle ? 0.05 : 0.32 + 0.12 * lag)
    }
    oval(hc, hr * 1.05, hr)
    let sn = CGFloat(sp.snout), sh2 = CGFloat(sp.snoutH)
    if sn > 1.6 {  // a dog's or fox's muzzle points forward and down from the turned face
        let mc = rot(NSPoint(x: hc.x + hr * 0.62 + sn * 0.2, y: hc.y - hr * 0.45), hc, hpitch)
        oval(mc, hr * 0.42 + sn * 0.24, sh2 * 0.7 + 0.45)
        if sp.hump { oval(rot(NSPoint(x: mc.x + hr * 0.42 + sn * 0.2, y: mc.y + sh2 * 0.5), mc, 0), 0.85, 0.7) }  // a bear's nose at the tip
    }
    let back = (lift > 0.8 ? 0.35 : 0.0) + (idle ? 0 : 0.12)
    func ear(_ base0: CGFloat, _ base1: CGFloat, _ tipX: CGFloat, _ tipY: CGFloat) {
        let a = rot(NSPoint(x: hc.x + base0, y: hc.y + hr * 0.55), hc, hpitch), b = rot(NSPoint(x: hc.x + base1, y: hc.y + hr * 0.7), hc, hpitch)
        let tip = rot(NSPoint(x: hc.x + tipX, y: hc.y + tipY), hc, hpitch + CGFloat(back))
        let e = NSBezierPath(); e.move(to: a); e.line(to: tip); e.line(to: b); e.close(); e.fill()
    }
    switch sp.ear {
    case .pricked: ear(-hr * 0.9, -hr * 0.15, -hr * 0.7, hr * 1.75); ear(hr * 0.05, hr * 0.85, hr * 0.55, hr * 1.75)
    case .cat: ear(-hr * 0.95, -hr * 0.2, -hr * 0.72, hr * 1.55); ear(hr * 0.0, hr * 0.85, hr * 0.5, hr * 1.55)
    case .round:
        for dx in [-hr * 0.6, hr * 0.45] { let p = rot(NSPoint(x: hc.x + dx, y: hc.y + hr * 0.82), hc, hpitch); oval(p, hr * 0.38, hr * 0.38) }
    case .long:
        for (dx, sw) in [(-hr * 0.45, 0.1), (hr * 0.2, 0.3)] as [(CGFloat, CGFloat)] {
            let base = rot(NSPoint(x: hc.x + dx, y: hc.y + hr * 0.6), hc, hpitch)
            let ang = hpitch + CGFloat(back) * 1.6 + 0.3 + sw - lag * 0.15
            let tip = NSPoint(x: base.x - sin(ang) * hr * 1.55, y: base.y + cos(ang) * hr * 1.55)
            taper(base, tip, hr * 0.42, hr * 0.36)
        }
    case .tiny, .none: break
    case .floppy:   // a puppy's ears hang and swing
        // the far ear peeks over the crown; the near one hangs by the cheek, set off from the head by a thin gap
        let fb = rot(NSPoint(x: hc.x + hr * 0.55, y: hc.y + hr * 0.75), hc, hpitch)
        taper(fb, NSPoint(x: fb.x + hr * 0.35, y: fb.y - hr * 0.35), hr * 0.5, hr * 0.45)
        let base = rot(NSPoint(x: hc.x - hr * 0.88, y: hc.y + hr * 0.55), hc, hpitch)
        let tip = NSPoint(x: base.x - hr * 0.55 - lag * hr * 0.3, y: base.y - hr * 1.4 + (lift > 0.8 ? hr * 0.55 : 0))
        NSGraphicsContext.current?.compositingOperation = .clear
        taper(base, tip, hr * 0.5 + 1.0, hr * 0.66 + 1.0)
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        taper(base, tip, hr * 0.5, hr * 0.66)
    case .side:     // round ears on the sides: big and fluffy on a koala
        let big = sp.x.contains("koalanose")
        for (dx, dy, r) in [(-hr * (big ? 0.95 : 1.0), hr * (big ? 0.55 : 0.15), hr * (big ? 0.62 : 0.36)), (hr * (big ? 0.8 : 0.95), hr * (big ? 0.6 : 0.2), hr * (big ? 0.5 : 0.3))] as [(CGFloat, CGFloat, CGFloat)] {
            let ec = rot(NSPoint(x: hc.x + dx, y: hc.y + dy), hc, hpitch)
            oval(ec, r, r)
            if big { NSGraphicsContext.current?.compositingOperation = .clear; oval(NSPoint(x: ec.x + (dx < 0 ? -r * 0.12 : r * 0.12), y: ec.y + r * 0.05), r * 0.55, r * 0.55); NSGraphicsContext.current?.compositingOperation = .sourceOver }
        }
    case .mouse:
        for (dx, r) in [(-hr * 0.55, hr * 0.62), (hr * 0.45, hr * 0.55)] as [(CGFloat, CGFloat)] { oval(rot(NSPoint(x: hc.x + dx, y: hc.y + hr * 1.0), hc, hpitch), r, r) }
    case .horse: ear(-hr * 0.6, -hr * 0.15, -hr * 0.55, hr * 1.6); ear(hr * 0.0, hr * 0.4, hr * 0.15, hr * 1.55)
    case .sheep:
        for (dx, f) in [(-hr * 0.7, 1.0), (hr * 0.4, 0.8)] as [(CGFloat, CGFloat)] { let b = rot(NSPoint(x: hc.x + dx, y: hc.y + hr * 0.45), hc, hpitch); taper(b, NSPoint(x: b.x - hr * 0.9 * f, y: b.y - hr * 0.1 + lag * 0.2), hr * 0.42, hr * 0.32) }
    case .pig: ear(-hr * 0.85, -hr * 0.15, hr * 0.1, hr * 1.35); ear(hr * 0.0, hr * 0.7, hr * 0.95, hr * 1.2)
    }
    // head features
    if sp.x.contains("horn") {
        let a = rot(NSPoint(x: hc.x + hr * 0.15, y: hc.y + hr * 0.8), hc, hpitch), b = rot(NSPoint(x: hc.x + hr * 0.65, y: hc.y + hr * 0.85), hc, hpitch), t = rot(NSPoint(x: hc.x + hr * 1.15, y: hc.y + hr * 2.25), hc, hpitch)
        let h = NSBezierPath(); h.move(to: a); h.line(to: t); h.line(to: b); h.close(); h.fill()
    }
    if sp.x.contains("neckmane") {   // a mane down the back of the neck, streaming in the run
        for i in 0..<5 {
            let t = CGFloat(i) / 4, base = NSPoint(x: hc.x - hr * 0.75 + (S.x - 0.6 - hc.x + hr * 0.75) * t, y: hc.y + hr * 0.55 + (S.y + CGFloat(sp.chest) * 0.7 - hc.y - hr * 0.55) * t)
            let tip = NSPoint(x: base.x - 2.2 - lag * 0.5, y: base.y + 0.4 - t * 0.6)
            let m = NSBezierPath(); m.move(to: NSPoint(x: base.x + 0.7, y: base.y + 0.4)); m.line(to: tip); m.line(to: NSPoint(x: base.x + 0.3, y: base.y - 0.9)); m.close(); m.fill()
        }
    }
    if sp.x.contains("antlers") {
        for (dx, f) in [(-hr * 0.35, 1.0), (hr * 0.2, 0.85)] as [(CGFloat, CGFloat)] {
            let b = rot(NSPoint(x: hc.x + dx, y: hc.y + hr * 0.8), hc, hpitch)
            let top = NSPoint(x: b.x - hr * 0.7 * f, y: b.y + hr * 1.7 * f), m1 = NSPoint(x: b.x - hr * 0.25 * f, y: b.y + hr * 0.75 * f), m2 = NSPoint(x: b.x - hr * 0.5 * f, y: b.y + hr * 1.25 * f)
            line2(b, top, 0.75); line2(m1, NSPoint(x: m1.x + hr * 0.55 * f, y: m1.y + hr * 0.45 * f), 0.65); line2(m2, NSPoint(x: m2.x + hr * 0.5 * f, y: m2.y + hr * 0.55 * f), 0.6)
        }
    }
    if sp.x.contains("trunk") {     // an elephant: a big ear set apart from the head, and a swinging trunk
        let ec = rot(NSPoint(x: hc.x - hr * 0.95, y: hc.y - hr * 0.05), hc, hpitch)
        NSGraphicsContext.current?.compositingOperation = .clear
        NSBezierPath(ovalIn: NSRect(x: ec.x - hr * 0.78, y: ec.y - hr * 0.98, width: hr * 1.56, height: hr * 1.96)).fill()
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        oval(ec, hr * 0.68 + lag * 0.15, hr * 0.88)
        let r0 = rot(NSPoint(x: hc.x + hr * 0.8, y: hc.y - hr * 0.25), hc, hpitch), mid = NSPoint(x: r0.x + hr * 0.55, y: r0.y - hr * 0.8), tip = NSPoint(x: r0.x + hr * 0.6 + lag * hr * 0.35, y: r0.y - hr * 1.7)
        taper(r0, mid, hr * 0.7, hr * 0.5); taper(mid, tip, hr * 0.5, hr * 0.38)
    }
    if sp.x.contains("pigsnout") {
        let c2 = rot(NSPoint(x: hc.x + hr * 1.0, y: hc.y - hr * 0.3), hc, hpitch)
        oval(c2, hr * 0.38, hr * 0.48)
        NSGraphicsContext.current?.compositingOperation = .clear
        for dy in [hr * 0.15, -hr * 0.17] { oval(NSPoint(x: c2.x + hr * 0.12, y: c2.y + dy), hr * 0.09, hr * 0.12) }
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }
    if sp.x.contains("koalanose") { oval(rot(NSPoint(x: hc.x + hr * 1.0, y: hc.y - hr * 0.2), hc, hpitch), hr * 0.38, hr * 0.5) }
    if sp.x.contains("panda") {     // pale face, dark eye patches
        NSGraphicsContext.current?.compositingOperation = .clear
        oval(hc, hr * 0.84, hr * 0.8)
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        for (x, y, r) in [(0.42, 0.06, 0.36), (-0.2, 0.1, 0.3)] as [(CGFloat, CGFloat, CGFloat)] {
            let p = NSBezierPath(ovalIn: NSRect(x: -r * hr, y: -r * hr * 0.8, width: 2 * r * hr, height: 1.6 * r * hr))
            let tr = NSAffineTransform(); tr.translateX(by: hc.x + hr * x, yBy: hc.y + hr * y); tr.rotate(byRadians: -0.5); p.transform(using: tr as AffineTransform); p.fill()
        }
        oval(NSPoint(x: hc.x + hr * 0.78, y: hc.y - hr * 0.32), hr * 0.17, hr * 0.13)
    }
    // near legs
    if !sp.x.contains("wool") { leg(sh, k.fn, CGFloat(sp.legF) * LEGK, true); leg(hp, k.hn, CGFloat(sp.legH) * LEGK, true) }
    eyes(NSPoint(x: hc.x + hr * CGFloat(sp.eyeDx), y: hc.y), hr, hpitch, CGFloat(sp.eyeK))
}

/** A penguin does not gallop: it waddles, rocking side to side with the flippers out. */
func penguin(frame: Int, idle: Bool) {
    let n = GAL.count, ph = 2 * CGFloat.pi * CGFloat(frame % n) / CGFloat(n)
    let rock = idle ? 0.04 * sin(ph) : 0.2 * sin(ph), hop = idle ? 0 : 0.7 * abs(cos(ph))
    let ground: CGFloat = 1.3
    let base = NSPoint(x: 15.5, y: ground + 1.4 + hop)
    let c = NSPoint(x: base.x, y: base.y + 7.4)
    // feet: the one carrying the weight stays down
    for (i, dx) in [(0, -1.8), (1, 1.6)] as [(Int, CGFloat)] {
        let up = idle ? 0 : max(0, (i == 0 ? 1 : -1) * sin(ph)) * 1.2
        oval(NSPoint(x: base.x + dx + 1.0, y: ground + 0.5 + up), 1.9, 0.75)
    }
    let body = NSBezierPath(ovalIn: NSRect(x: c.x - 5.0, y: c.y - 7.6, width: 10.0, height: 14.4))
    let t = NSAffineTransform(); t.translateX(by: base.x, yBy: base.y); t.rotate(byRadians: rock); t.translateX(by: -base.x, yBy: -base.y)
    body.transform(using: t as AffineTransform); body.fill()
    let head = rot(NSPoint(x: c.x + 0.6, y: c.y + 7.2), base, rock)
    oval(head, 3.7, 3.4)
    let b1 = rot(NSPoint(x: c.x + 3.6, y: c.y + 7.6), base, rock), b2 = rot(NSPoint(x: c.x + 7.0, y: c.y + 6.5), base, rock), b3 = rot(NSPoint(x: c.x + 3.4, y: c.y + 6.0), base, rock)
    let beak = NSBezierPath(); beak.move(to: b1); beak.line(to: b2); beak.line(to: b3); beak.close(); beak.fill()
    for (sx, sgn) in [(-4.4, -1.0), (4.4, 1.0)] as [(CGFloat, CGFloat)] {   // flippers flap out
        let root = rot(NSPoint(x: c.x + sx, y: c.y + 2.2), base, rock)
        let ang = (idle ? 0.25 : 0.45 + 0.35 * sin(ph * 2)) * sgn
        line2(root, NSPoint(x: root.x + sin(ang) * 5.2, y: root.y - cos(ang) * 5.2), 1.9)
    }
    NSGraphicsContext.current?.compositingOperation = .clear
    let belly = NSBezierPath(ovalIn: NSRect(x: c.x - 1.2, y: c.y - 6.0, width: 5.4, height: 10.2))
    belly.transform(using: t as AffineTransform); belly.fill()
    eyes(head, 3.4, rock)
}

let HEADK: CGFloat = 1.42, LEGK: CGFloat = 0.72, BODYK: CGFloat = 0.74
/** Two eyes on a face turned toward the viewer: the far one a little smaller, pupils looking where the animal runs. */
func eyes(_ hc: NSPoint, _ hr: CGFloat, _ a: CGFloat, _ k: CGFloat = 1) {
    let spots: [(CGFloat, CGFloat, CGFloat)] = [(0.42, 0.1, 0.33 * k), (-0.2, 0.14, 0.28 * k)]
    NSGraphicsContext.current?.compositingOperation = .clear
    for (x, y, r) in spots { oval(rot(NSPoint(x: hc.x + hr * x, y: hc.y + hr * y), hc, a), hr * r, hr * r * 1.1) }
    NSGraphicsContext.current?.compositingOperation = .sourceOver
    for (x, y, r) in spots { oval(rot(NSPoint(x: hc.x + hr * (x + r * 0.35), y: hc.y + hr * y), hc, a), hr * r * 0.5, hr * r * 0.6) }
}
func taper(_ a: NSPoint, _ b: NSPoint, _ w1: CGFloat, _ w2: CGFloat) {
    let dx = b.x - a.x, dy = b.y - a.y, d = max(0.001, hypot(dx, dy)), nx = -dy / d, ny = dx / d
    let p = NSBezierPath()
    p.move(to: NSPoint(x: a.x + nx * w1 / 2, y: a.y + ny * w1 / 2)); p.line(to: NSPoint(x: b.x + nx * w2 / 2, y: b.y + ny * w2 / 2))
    p.line(to: NSPoint(x: b.x - nx * w2 / 2, y: b.y - ny * w2 / 2)); p.line(to: NSPoint(x: a.x - nx * w1 / 2, y: a.y - ny * w1 / 2)); p.close(); p.fill()
    oval(a, w1 / 2, w1 / 2); oval(b, w2 / 2, w2 / 2)
}


/** Birds and the dragon fly: the wings beat, the body rises on the downstroke, a level wing is seen end-on and looks short. */
func flyer(_ sp: Sp, frame: Int, idle: Bool) {
    let n = GAL.count, ph = 2 * CGFloat.pi * CGFloat(frame % n) / CGFloat(n)
    let ground: CGFloat = 1.3, style = sp.fly
    let flap: CGFloat = idle ? 0 : sin(ph)
    let bob: CGFloat = idle ? 0.15 * sin(ph) : -flap * 1.1
    let c = NSPoint(x: style == 3 ? 15.0 : 14.2, y: idle ? ground + 6.6 + bob : 10.0 + bob)
    let tilt: CGFloat = idle ? 0 : 0.1
    func R(_ x: CGFloat, _ y: CGFloat) -> NSPoint { rot(NSPoint(x: c.x + x, y: c.y + y), c, tilt) }
    let shoulder = R(style == 2 ? -0.4 : 0.4, 1.4)
    func wing(_ near: Bool) {
        if idle {  // folded along the body
            let w = NSBezierPath(); let a = R(1.6, 1.6), t = R(style == 3 ? -5.6 : -6.0, -0.2)
            w.move(to: a); w.curve(to: t, controlPoint1: R(-1.0, 3.6), controlPoint2: R(-4.4, 2.6)); w.curve(to: a, controlPoint1: R(-3.6, -1.2), controlPoint2: R(-0.6, -0.6)); w.close(); w.fill()
            return
        }
        let phase = near ? flap : sin(ph - 0.35)
        let g = CGFloat.pi - phase * 1.2 + (near ? 0 : 0.1)
        let span: CGFloat = (style == 2 ? 8.6 : style == 3 ? 8.8 : 9.8) * (0.42 + 0.58 * abs(phase)) * (near ? 1 : 0.85)
        let u = NSPoint(x: cos(g), y: sin(g))
        var v = NSPoint(x: -u.y, y: u.x); if v.x > 0 { v = NSPoint(x: -v.x, y: -v.y) }      // toward the tail
        func P(_ along: CGFloat, _ back: CGFloat) -> NSPoint { NSPoint(x: shoulder.x + u.x * along + v.x * back, y: shoulder.y + u.y * along + v.y * back) }
        let w = NSBezierPath()
        switch style {
        case 1:  // eagle: broad wing, fingered tip
            w.move(to: P(0, -1.2)); w.curve(to: P(span, 0.2), controlPoint1: P(span * 0.4, -1.6), controlPoint2: P(span * 0.8, -0.8))
            for k in 0..<4 { let a = span * (1 - 0.13 * CGFloat(k)); w.line(to: P(a - 0.4, 1.0 + 0.55 * CGFloat(k))); w.line(to: P(a - 1.0, 0.7 + 0.6 * CGFloat(k))) }
            w.curve(to: P(-0.6, 3.0), controlPoint1: P(span * 0.4, 3.4), controlPoint2: P(span * 0.15, 3.4))
        case 2:  // owl: round, soft wing
            w.move(to: P(0, -1.0)); w.curve(to: P(span, 0.8), controlPoint1: P(span * 0.5, -1.8), controlPoint2: P(span * 1.05, -0.6))
            w.curve(to: P(-0.4, 3.2), controlPoint1: P(span * 0.9, 3.4), controlPoint2: P(span * 0.3, 4.0))
        default: // dragon: bat wing, membrane scalloped between finger spars
            let tips: [(CGFloat, CGFloat)] = [(span, -0.2), (span * 0.82, 2.4), (span * 0.55, 3.6)]
            w.move(to: P(0, -0.8)); w.line(to: P(span * 0.55, -1.0)); w.line(to: P(tips[0].0, tips[0].1))
            var prev = tips[0]
            for t in tips.dropFirst() { let mid = P((prev.0 + t.0) / 2 - 1.4, (prev.1 + t.1) / 2 - 0.2); w.curve(to: P(t.0, t.1), controlPoint1: mid, controlPoint2: mid); prev = t }
            let mid = P(prev.0 / 2 - 1.0, 2.0); w.curve(to: P(-0.6, 2.6), controlPoint1: mid, controlPoint2: mid)
            for t in tips { line2(P(0, 0.2), P(t.0, t.1), 0.75) }
        }
        w.close(); w.fill()
    }
    wing(false)
    // tail
    switch style {
    case 1: let t = NSBezierPath(); t.move(to: R(-4.0, 1.2)); t.line(to: R(-8.4, 2.4)); t.line(to: R(-8.6, -1.2)); t.line(to: R(-4.0, -0.8)); t.close(); t.fill()
    case 2: let t = NSBezierPath(); t.move(to: R(-3.6, 0.8)); t.line(to: R(-6.2, 0.6)); t.line(to: R(-5.8, -1.4)); t.line(to: R(-3.2, -1.2)); t.close(); t.fill()
    default:
        let wv = idle ? 0.3 * sin(ph) : 1.4 * sin(ph - 1.2)
        let t = NSBezierPath(); t.lineCapStyle = .round
        let end = R(-11.2, 0.4 + wv)
        t.move(to: R(-3.0, 0.2)); t.curve(to: end, controlPoint1: R(-6.0, -1.6 - wv), controlPoint2: R(-8.6, 1.6 + wv))
        t.lineWidth = 1.6; t.stroke()
        let sp = NSBezierPath(); sp.move(to: NSPoint(x: end.x + 0.6, y: end.y)); sp.line(to: NSPoint(x: end.x - 1.4, y: end.y + 1.3)); sp.line(to: NSPoint(x: end.x - 1.0, y: end.y - 1.4)); sp.close(); sp.fill()
    }
    // legs: tucked in flight, standing at rest
    for dx in [CGFloat(-1.2), 0.4] {
        let hip = R(dx, -1.6)
        let foot = idle ? NSPoint(x: hip.x + 0.3, y: ground + 0.3) : R(dx - 1.6, -3.6)
        taper(hip, foot, style == 3 ? 1.8 : 1.2, 0.9)
        if idle { oval(NSPoint(x: foot.x + 0.5, y: foot.y), 1.1, 0.5) }
    }
    // body
    let (rx, ry): (CGFloat, CGFloat) = style == 2 ? (4.2, 3.9) : style == 3 ? (4.6, 2.9) : (4.8, 3.1)
    let body = NSBezierPath(ovalIn: NSRect(x: c.x - rx, y: c.y - ry, width: rx * 2, height: ry * 2))
    let tr = NSAffineTransform(); tr.translateX(by: c.x, yBy: c.y); tr.rotate(byRadians: tilt); tr.translateX(by: -c.x, yBy: -c.y)
    body.transform(using: tr as AffineTransform); body.fill()
    // head, three-quarters toward the viewer
    let hr: CGFloat = style == 2 ? 3.6 : 3.3
    let hc = style == 2 ? R(2.4, 3.6) : style == 3 ? R(5.4, 3.6) : R(4.6, 2.9)
    if style == 3 { line2(R(3.0, 1.4), hc, 2.6) }
    oval(hc, hr * 1.02, hr)
    switch style {
    case 1:  // hooked beak
        let b = NSBezierPath(); b.move(to: NSPoint(x: hc.x + hr * 0.55, y: hc.y + hr * 0.15)); b.line(to: NSPoint(x: hc.x + hr * 1.45, y: hc.y - hr * 0.05))
        b.curve(to: NSPoint(x: hc.x + hr * 1.05, y: hc.y - hr * 0.7), controlPoint1: NSPoint(x: hc.x + hr * 1.7, y: hc.y - hr * 0.35), controlPoint2: NSPoint(x: hc.x + hr * 1.4, y: hc.y - hr * 0.75))
        b.line(to: NSPoint(x: hc.x + hr * 0.5, y: hc.y - hr * 0.5)); b.close(); b.fill()
    case 2:  // ear tufts and a small beak
        for (x0, tip, x1) in [(-0.85, -0.85, -0.25), (0.15, 0.75, 0.8)] as [(CGFloat, CGFloat, CGFloat)] {
            let e = NSBezierPath(); e.move(to: NSPoint(x: hc.x + hr * x0, y: hc.y + hr * 0.6)); e.line(to: NSPoint(x: hc.x + hr * tip, y: hc.y + hr * 1.45)); e.line(to: NSPoint(x: hc.x + hr * x1, y: hc.y + hr * 0.75)); e.close(); e.fill()
        }
    default: // snout and two little horns
        oval(NSPoint(x: hc.x + hr * 0.95, y: hc.y - hr * 0.35), hr * 0.75, hr * 0.5)
        for (x0, tip) in [(-0.6, -1.05), (0.1, -0.2)] as [(CGFloat, CGFloat)] {
            let h = NSBezierPath(); h.move(to: NSPoint(x: hc.x + hr * x0, y: hc.y + hr * 0.7)); h.line(to: NSPoint(x: hc.x + hr * tip, y: hc.y + hr * 1.5)); h.line(to: NSPoint(x: hc.x + hr * (x0 + 0.4), y: hc.y + hr * 0.8)); h.close(); h.fill()
        }
    }
    wing(true)
    if style == 2 {  // an owl's face is all eyes
        NSGraphicsContext.current?.compositingOperation = .clear
        for x in [-0.42, 0.42] as [CGFloat] { oval(NSPoint(x: hc.x + hr * x, y: hc.y + hr * 0.05), hr * 0.38, hr * 0.4) }
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        for x in [-0.42, 0.42] as [CGFloat] { oval(NSPoint(x: hc.x + hr * (x + 0.1), y: hc.y + hr * 0.02), hr * 0.18, hr * 0.2) }
        let b = NSBezierPath(); b.move(to: NSPoint(x: hc.x - hr * 0.12, y: hc.y - hr * 0.35)); b.line(to: NSPoint(x: hc.x + hr * 0.12, y: hc.y - hr * 0.35)); b.line(to: NSPoint(x: hc.x, y: hc.y - hr * 0.7)); b.close(); b.fill()
    } else {
        eyes(hc, hr, 0)
    }
}

/** A lion's mane drawn as fur: leaf-shaped locks of uneven length, longest over the crown and nape, their tips curling back with the run. */
func lionMane(_ hc: NSPoint, _ hr: CGFloat, sweep: CGFloat) {
    let c = NSPoint(x: hc.x - hr * 0.3, y: hc.y - hr * 0.05), n = 13
    let jag: [CGFloat] = [1.0, 0.86, 0.96, 0.8, 1.0, 0.9, 0.78]   // fixed, so the locks do not flicker between frames
    oval(c, hr * 1.5, hr * 1.45)
    for i in 0..<n {
        let a = 2 * CGFloat.pi * CGFloat(i) / CGFloat(n) + 0.1
        let back = (1 - cos(a)) / 2                                 // 0 at the front, 1 at the back
        let len = hr * (1.95 + 0.6 * back) * jag[i % jag.count]
        let u = NSPoint(x: cos(a), y: sin(a)), w = NSPoint(x: -sin(a), y: cos(a))
        let wd = hr * 0.5, base = hr * 1.25
        func at(_ along: CGFloat, _ side: CGFloat) -> NSPoint { NSPoint(x: c.x + u.x * along + w.x * side, y: c.y + u.y * along + w.y * side) }
        // the tip curls toward the tail, more when running and more for the locks at the back
        var tip = at(len, 0); tip.x -= sweep * hr * (0.4 + 0.7 * back); tip.y -= sweep * hr * 0.2
        let l = NSBezierPath()
        l.move(to: at(base, wd))
        l.curve(to: tip, controlPoint1: at(len * 0.72, wd * 1.15), controlPoint2: NSPoint(x: (tip.x + at(len * 0.9, wd * 0.5).x) / 2, y: (tip.y + at(len * 0.9, wd * 0.5).y) / 2))
        l.curve(to: at(base, -wd), controlPoint1: at(len * 0.85, -wd * 0.3), controlPoint2: at(len * 0.6, -wd * 1.0))
        l.close(); l.fill()
    }
}

/** A feathered wing seen from the side: swept back from the root, longest feathers at the tip, foreshortened when level. */
func featherWing(_ root: NSPoint, flap: CGFloat, span full: CGFloat, near: Bool) {
    let g = CGFloat.pi - flap * 1.05 - 0.15
    let span = full * (0.45 + 0.55 * abs(flap)) * (near ? 1 : 0.85)
    let u = NSPoint(x: cos(g), y: sin(g))
    var v = NSPoint(x: -u.y, y: u.x); if v.x > 0 { v = NSPoint(x: -v.x, y: -v.y) }    // toward the tail
    func P(_ along: CGFloat, _ back: CGFloat) -> NSPoint { NSPoint(x: root.x + u.x * along + v.x * back, y: root.y + u.y * along + v.y * back) }
    let w = NSBezierPath()
    w.move(to: P(0, -1.0)); w.curve(to: P(span, 0.4), controlPoint1: P(span * 0.45, -1.5), controlPoint2: P(span * 0.85, -0.7))
    // rounded feather ends along the trailing edge
    for k in 0..<4 {
        let a = span * (1 - 0.2 * CGFloat(k)), b = span * (1 - 0.2 * CGFloat(k + 1))
        let depth = 1.4 + 0.45 * CGFloat(k)
        w.curve(to: P(b, depth + 0.5), controlPoint1: P(a - 0.1, depth + 1.0), controlPoint2: P(b + 0.6, depth + 1.3))
    }
    w.curve(to: P(-0.4, 2.2), controlPoint1: P(span * 0.15, 2.9), controlPoint2: P(0.2, 2.8))
    w.close()
    if near {   // a thin gap around the near wing, so it stays apart from the body on the downstroke
        NSGraphicsContext.current?.compositingOperation = .clear
        w.lineWidth = 1.1; w.lineJoinStyle = .round; w.stroke()
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }
    w.fill()
    if near {   // a line of coverts, cut in, so the near wing reads apart from the body
        NSGraphicsContext.current?.compositingOperation = .clear
        let l = NSBezierPath(); l.lineWidth = 0.5; l.lineCapStyle = .round
        l.move(to: P(span * 0.1, 0.9)); l.curve(to: P(span * 0.7, 0.9), controlPoint1: P(span * 0.3, 1.5), controlPoint2: P(span * 0.5, 1.4)); l.stroke()
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }
}

/** A frog hops: it crouches, kicks its long hind legs straight out behind, flies in an arc and lands on its front feet. */
func frog(frame: Int, idle: Bool) {
    let n = GAL.count, i = frame % n, ground: CGFloat = 1.3
    // phase of the hop: 0 crouched, 1 fully stretched in the air
    let ext: [CGFloat] = [0.0, 0.7, 1.0, 0.85, 0.55, 0.3, 0.1, 0.0]
    let hgt: [CGFloat] = [0.0, 1.6, 4.2, 5.4, 4.8, 2.8, 0.6, 0.0]
    let tilt: [CGFloat] = [0.0, 0.38, 0.3, 0.12, -0.08, -0.25, -0.3, -0.05]
    let e = idle ? 0 : ext[i], h = idle ? 0.15 * sin(CGFloat(frame) * 0.8) : hgt[i], a = idle ? 0 : tilt[i]
    let c = NSPoint(x: 15.0, y: ground + 3.4 + h)
    func R(_ x: CGFloat, _ y: CGFloat) -> NSPoint { rot(NSPoint(x: c.x + x, y: c.y + y), c, a) }
    let hip = R(-3.4, -0.6)
    // hind leg: folded in a Z when crouched, a straight line back when stretched
    for (near, w) in [(false, 0.85), (true, 1.0)] as [(Bool, CGFloat)] {
        let dz: CGFloat = near ? 0 : 0.5
        let knee = NSPoint(x: hip.x + 2.6 * (1 - e) - 3.6 * e, y: hip.y - 1.0 * (1 - e) - 1.4 * e + dz)
        var foot = NSPoint(x: knee.x - 3.4 * (1 - e) - 3.8 * e, y: max(ground, knee.y - 1.6 * (1 - e) - 1.6 * e))
        if h > 0.5 { foot.y = knee.y - 1.6 * (1 - e) - 1.4 * e }
        taper(hip, knee, 2.4 * w, 1.6 * w); taper(knee, foot, 1.6 * w, 1.0 * w)
        oval(NSPoint(x: foot.x - 0.6, y: foot.y), 1.4 * w, 0.6)
    }
    // body: a wide, low pear, with the head part of it
    oval(R(-0.6, 0), 4.6, 3.0)
    oval(R(2.6, 0.8), 3.4, 2.6)
    // front legs reach forward when landing
    let sh = R(2.4, -1.2), reach = idle ? 0 : max(0, -a) * 2.4 + (i == 0 || i == 7 ? 0.4 : 0)
    for (near, w) in [(false, 0.8), (true, 1.0)] as [(Bool, CGFloat)] {
        let foot = NSPoint(x: sh.x + 0.8 + reach + (near ? 0 : -0.6), y: max(ground, sh.y - 2.8 + (h > 1.2 ? 1.2 : 0)))
        taper(sh, foot, 1.5 * w, 1.0 * w); oval(NSPoint(x: foot.x + 0.4, y: foot.y), 1.0 * w, 0.5)
    }
    // bulging eyes on top of the head
    let e1 = R(3.6, 3.0), e2 = R(1.4, 3.1)
    oval(e1, 1.55, 1.5); oval(e2, 1.35, 1.35)
    NSGraphicsContext.current?.compositingOperation = .clear
    oval(e1, 1.0, 1.0); oval(e2, 0.85, 0.85)
    line2(R(3.0, -0.2), R(5.4, 0.6), 0.45)     // a wide mouth
    NSGraphicsContext.current?.compositingOperation = .sourceOver
    oval(NSPoint(x: e1.x + 0.35, y: e1.y), 0.5, 0.55); oval(NSPoint(x: e2.x + 0.3, y: e2.y), 0.42, 0.48)
}

/** Two legs: a duck waddles with its tail up and a flat bill; a chick is a round ball on quick little legs, flapping its stubs. */
func biped(chick: Bool, frame: Int, idle: Bool) {
    let n = GAL.count, ph = 2 * CGFloat.pi * CGFloat(frame % n) / CGFloat(n)
    let ground: CGFloat = 1.3
    let bob: CGFloat = idle ? 0.15 * sin(ph) : abs(sin(ph)) * (chick ? 1.1 : 0.7)
    let roll: CGFloat = idle ? 0 : (chick ? 0.08 : 0.12) * sin(ph)
    let legLen: CGFloat = chick ? 4.2 : 3.8
    let c = NSPoint(x: 14.6, y: ground + legLen + (chick ? 4.0 : 3.0) + bob)
    func R(_ x: CGFloat, _ y: CGFloat) -> NSPoint { rot(NSPoint(x: c.x + x, y: c.y + y), c, roll) }
    // legs: one in front, one behind, swapping each half stride
    for k in 0..<2 {
        let sw = idle ? 0 : sin(ph + CGFloat(k) * .pi) * (chick ? 0.7 : 0.5)
        let hip = R(chick ? 0.2 : 0.6, chick ? -3.6 : -2.4)
        let foot = NSPoint(x: hip.x + sin(sw) * legLen, y: max(ground, hip.y - cos(sw) * legLen + (idle ? 0 : max(0, -cos(ph + CGFloat(k) * .pi)) * 1.2)))
        line2(hip, foot, chick ? 0.75 : 1.0)
        if chick { line2(foot, NSPoint(x: foot.x + 1.4, y: foot.y), 0.6); line2(foot, NSPoint(x: foot.x + 1.0, y: foot.y + 0.7), 0.5) }
        else { let w = NSBezierPath(); w.move(to: NSPoint(x: foot.x - 0.4, y: foot.y + 0.3)); w.line(to: NSPoint(x: foot.x + 2.2, y: foot.y + 0.1)); w.line(to: NSPoint(x: foot.x + 1.8, y: foot.y - 0.6)); w.line(to: NSPoint(x: foot.x - 0.6, y: foot.y - 0.4)); w.close(); w.fill() }
    }
    var hc: NSPoint, hr: CGFloat
    if chick {
        oval(c, 5.0, 4.8)                                 // the ball
        hc = R(1.6, 2.4); hr = 3.2
        oval(hc, hr, hr)
        // a tuft on top
        line2(R(1.0, 5.4), R(0.2, 7.0), 0.7); line2(R(1.6, 5.5), R(1.9, 7.1), 0.7)
        // a beak
        let b = NSBezierPath(); b.move(to: R(4.4, 3.0)); b.line(to: R(6.6, 2.3)); b.line(to: R(4.4, 1.6)); b.close(); b.fill()
        // stubby wings flap fast
        let fl = idle ? 0.2 : 0.5 + 0.5 * sin(ph * 2)
        let wr = R(-2.4, 0.6)
        let w = NSBezierPath(); w.move(to: NSPoint(x: wr.x + 1.2, y: wr.y + 0.6)); w.line(to: NSPoint(x: wr.x - 2.6, y: wr.y + 0.4 + fl * 2.6)); w.line(to: NSPoint(x: wr.x - 1.6, y: wr.y - 1.0)); w.close(); w.fill()
    } else {
        // body: a boat with the tail turned up
        let b = NSBezierPath()
        b.move(to: R(-6.4, 2.2))
        b.curve(to: R(3.8, 0.4), controlPoint1: R(-4.0, 1.2), controlPoint2: R(0.6, 2.6))
        b.curve(to: R(-1.0, -3.4), controlPoint1: R(5.4, -2.0), controlPoint2: R(2.4, -3.6))
        b.curve(to: R(-6.4, 2.2), controlPoint1: R(-4.6, -3.2), controlPoint2: R(-5.6, -1.0))
        b.close(); b.fill()
        line2(R(2.6, 0.6), R(3.4, 4.0), 2.6)              // neck
        hc = R(3.6, 5.0); hr = 2.6
        oval(hc, hr, hr * 0.95)
        // a flat, rounded bill
        let bl = NSBezierPath(roundedRect: NSRect(x: hc.x + hr * 0.6, y: hc.y - hr * 0.6, width: hr * 1.25, height: hr * 0.55), xRadius: hr * 0.27, yRadius: hr * 0.27); bl.fill()
        // a wing drawn as a cut line on the side, lifting a little each step
        NSGraphicsContext.current?.compositingOperation = .clear
        let w = NSBezierPath(); w.lineWidth = 0.55; w.lineCapStyle = .round
        w.move(to: R(1.8, 0.6)); w.curve(to: R(-4.2, 0.6 + (idle ? 0 : 0.8 * max(0, sin(ph)))), controlPoint1: R(0.4, -2.2), controlPoint2: R(-3.0, -1.6)); w.stroke()
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }
    eyes(hc, hr, roll, chick ? 0.9 : 0.85)
}

/** The ghost, for a member with no data: a see-through sheet that floats instead of running, its hem rippling. */
func ghost(frame: Int, idle: Bool) {
    let n = GAL.count, ph = 2 * CGFloat.pi * CGFloat(frame % n) / CGFloat(n)
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    ctx.saveGState(); ctx.setAlpha(0.62); ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    let bob: CGFloat = idle ? 0.5 * sin(ph) : 1.0 * sin(ph)
    let lean: CGFloat = idle ? 0 : -0.22                    // leaning into the direction it drifts
    let c = NSPoint(x: 16.0, y: 11.0 + bob)
    func R(_ x: CGFloat, _ y: CGFloat) -> NSPoint { rot(NSPoint(x: c.x + x, y: c.y + y), c, lean) }
    let p = NSBezierPath()
    p.move(to: R(-5.2, 0))
    p.curve(to: R(5.2, 0), controlPoint1: R(-5.2, 8.2), controlPoint2: R(5.2, 8.2))   // the dome of the head
    p.line(to: R(5.0, -5.2))
    // the hem: scallops that travel backward, and a wisp trailing behind
    let waves = 4, w0 = R(5.0, -5.2)
    var prev = w0
    for k in 1...waves {
        let x = 5.0 - 10.6 * CGFloat(k) / CGFloat(waves), dip = -6.6 - 0.9 * sin(ph * 1.0 + CGFloat(k) * 1.4)
        let to = R(x, -5.2 - (k == waves ? 1.6 : 0))
        let mid = R((x + 5.0 - 10.6 * CGFloat(k - 1) / CGFloat(waves)) / 2, dip)
        p.curve(to: to, controlPoint1: NSPoint(x: (prev.x + mid.x) / 2, y: mid.y), controlPoint2: NSPoint(x: (to.x + mid.x) / 2, y: mid.y))
        prev = to
    }
    let wisp = R(-8.6 - (idle ? 0 : 0.8 * sin(ph)), -5.6 + 1.2 * sin(ph + 1))
    p.curve(to: wisp, controlPoint1: R(-6.0, -6.6), controlPoint2: R(-7.4, -6.4))
    p.curve(to: R(-5.2, 0), controlPoint1: R(-7.0, -4.4), controlPoint2: R(-5.6, -2.6))
    p.close(); p.fill()
    // little arms reaching forward
    let arm = idle ? 0 : 0.5 * sin(ph * 2)
    line2(R(4.4, -0.6), R(7.0, 0.6 + arm), 1.5); line2(R(-4.0, -0.4), R(-5.8, 0.8 - arm), 1.3)
    // hollow eyes and a small round mouth
    NSGraphicsContext.current?.compositingOperation = .clear
    oval(R(2.0, 3.2), 1.05, 1.35); oval(R(-0.6, 3.3), 0.9, 1.2)
    oval(R(1.0, 0.9), 0.6, 0.75)
    NSGraphicsContext.current?.compositingOperation = .sourceOver
    ctx.endTransparencyLayer(); ctx.restoreGState()
}

// ---------- text ----------
func memText(_ mb: Double?) -> String { guard let mb = mb else { return "-" }; return mb < 1024 ? "\(Int(mb.rounded())) MB" : String(format: "%.1f GB", mb / 1024) }
func pct1(_ v: Double) -> String { String(format: "%.1f%%", v) }
func tokText(_ n: Double) -> String { n < 1000 ? "\(Int(n))" : n < 1_000_000 ? "\(Int((n / 1000).rounded()))k" : String(format: "%.1fM", n / 1_000_000) }
func sinceText(_ since: Double?, now: Double) -> String {
    guard let s = since else { return "" }
    let sec = max(0, Int((now - s) / 1000))
    if sec < 60 { return "\(sec)초째" }; if sec < 3600 { return "\(sec / 60)분째" }; if sec < 172800 { return "\(sec / 3600)시간째" }
    return "\(sec / 86400)일째"
}
func resetText(_ ms: Double?, now: Double) -> String {
    guard let ms = ms else { return "" }
    let sec = Int((ms - now) / 1000); if sec <= 0 { return "" }
    let d = sec / 86400, h = (sec % 86400) / 3600, m = (sec % 3600) / 60
    if d > 0 { return "\(d)일 \(h)시간 뒤 초기화" }; if h > 0 { return "\(h)시간 \(m)분 뒤 초기화" }
    return "\(m)분 뒤 초기화"
}
func windowName(_ w: Win) -> String {
    switch w.key {
    case "five_hour": return "5시간"
    case "seven_day": return "7일"
    case "seven_day_opus": return "7일 Opus"
    case "seven_day_sonnet": return "7일 Sonnet"
    default:
        let l = w.label
        if let n = Int(l.dropLast()), let unit = l.last { if unit == "D" { return "\(n)일" }; if unit == "H" { return "\(n)시간" }; if unit == "m" { return "\(n)분" } }
        return l
    }
}
func agoText(_ at: Double?, now: Double) -> String {
    guard let at = at else { return "" }
    let sec = max(0, Int((now - at) / 1000))
    if sec < 60 { return "\(sec)초 전" }; if sec < 3600 { return "\(sec / 60)분 전" }; if sec < 172800 { return "\(sec / 3600)시간 전" }
    return "\(sec / 86400)일 전"
}
func toolName(_ t: String) -> String { t.hasPrefix("mcp__") ? (t.components(separatedBy: "__").last ?? t) : t }
func stateColor(_ s: Session) -> Color {
    switch s.state { case "busy", "shell": return Color(red: 0.05, green: 0.64, blue: 0.05); case "idle": return Color(white: 0.55); case "waiting": return Color(red: 0.98, green: 0.70, blue: 0.10); case nil: return Color(white: 0.4); default: return .yellow }
}
func activity(_ s: Session, now: Double) -> String {
    var parts: [String] = []
    if let m = s.modelName { parts.append(s.effort.map { "\(m) \($0)" } ?? m) } else if let e = s.effort { parts.append("effort \(e)") }
    switch s.state {
    case "busy": parts.append(s.tools.isEmpty ? "작업 중" : (s.tools.count > 1 ? "\(s.tools[0]) 외 \(s.tools.count - 1)개 실행 중" : "\(s.tools[0]) 실행 중"))
    case "idle": parts.append("입력 대기")
    case "shell": parts.append("셸 명령 실행 중")
    case "waiting": parts.append("확인 대기")
    case nil: parts.append("상태 모름")
    default: parts.append(s.state ?? "")
    }
    if s.subagents > 0 { parts.append("서브에이전트 \(s.subagents)개") }
    let d = sinceText(s.stateSince, now: now); if !d.isEmpty { parts.append(d) }
    return parts.joined(separator: ", ")
}

// ---------- the panel ----------
struct Bar: View {
    let value: Double; let tint: Color
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.12))
                Capsule().fill(tint).frame(width: max(3, g.size.width * CGFloat(min(1, max(0, value)))))
            }
        }.frame(height: 5)
    }
}
/** History the way RunCat draws it: filled areas growing from the right. Grey is the whole machine, the colours are the agents. */
struct LoadChart: View {
    let sys: [Double], claude: [Double], codex: [Double]
    func area(_ v: [Double], _ size: CGSize) -> Path {
        Path { p in
            guard !v.isEmpty else { return }
            let step = size.width / 59, x0 = size.width - CGFloat(v.count - 1) * step
            p.move(to: CGPoint(x: x0, y: size.height))
            for (i, y) in v.enumerated() { p.addLine(to: CGPoint(x: x0 + CGFloat(i) * step, y: size.height * (1 - CGFloat(min(1, max(0, y)))))) }
            p.addLine(to: CGPoint(x: size.width, y: size.height)); p.closeSubpath()
        }
    }
    var body: some View {
        GeometryReader { g in
            ZStack {
                Color.primary.opacity(0.07)
                area(sys, g.size).fill(Color.primary.opacity(0.26))
                area(zip(claude, codex).map { $0 + $1 }, g.size).fill(CODEX)
                area(claude, g.size).fill(CLAUDE)
            }
        }.frame(height: 32).clipShape(RoundedRectangle(cornerRadius: 3))
    }
}
struct Block<Content: View>: View {
    let symbol: String; let title: String; @ViewBuilder var content: Content
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.system(size: 22, weight: .regular)).frame(width: 34, height: 26)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 15.5, weight: .semibold)).monospacedDigit()
                content
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.vertical, 11).padding(.horizontal, 12)
    }
}
struct Legend: View {
    let color: Color; let label: String; let value: String
    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 9, height: 9)
            Text(label).foregroundColor(.secondary)
            Text(value).monospacedDigit()
        }.font(.system(size: 12))
    }
}
struct Badge: View {
    let agent: String
    var body: some View {
        Text(agent == "codex" ? "Codex" : "Claude").font(.system(size: 9.5, weight: .bold)).foregroundColor(.white)
            .padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(agentTint(agent))).fixedSize()
    }
}
struct SessionRow: View {
    let s: Session; let cpu: Double; let mem: Double; let now: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 6) {
                Badge(agent: s.agent)
                Text(s.label).font(.system(size: 13, weight: .semibold)).lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 6)
                if let c = s.usage?.costUsd { Text(String(format: "$%.2f", c)).font(.system(size: 12.5, weight: .medium)).monospacedDigit().fixedSize().help("이 세션의 비용, 정가 환산") }
            }
            HStack(spacing: 6) {
                Circle().fill(stateColor(s)).frame(width: 7, height: 7)
                Text(activity(s, now: now)).font(.system(size: 11.5)).foregroundColor(.secondary).lineLimit(1)
            }
            if s.context != nil || s.usage != nil {
                HStack(spacing: 8) {
                    HStack(spacing: 3) { Image(systemName: "cpu").foregroundColor(.secondary); Text(s.cpu == nil ? "-" : pct1(cpu)).monospacedDigit() }.fixedSize().help("CPU, 기기 전체 대비")
                    HStack(spacing: 3) { Image(systemName: "memorychip").foregroundColor(.secondary); Text(s.rssMb == nil ? "-" : memText(mem)).monospacedDigit() }.fixedSize().help("메모리")
                    if let c = s.context {
                        Text("컨텍스트").foregroundColor(.secondary)
                        if let p = c.pct { Bar(value: p / 100, tint: p >= 80 ? .orange : agentTint(s.agent)).frame(width: 54); Text("\(Int(p))%").monospacedDigit() } else { Text(tokText(c.tokens)).monospacedDigit() }
                    }
                    // The panel's own scale: secondary, then the orange of a filling context, then the red of a danger pill.
                    if let n = s.compactions, n >= 1 {
                        Text("압축 \(n)").font(.system(size: 10.5, weight: .medium)).monospacedDigit().foregroundColor(n >= 3 ? .red : n == 2 ? .orange : .secondary).fixedSize().help(compactionTip(n))
                    }
                    Spacer(minLength: 0)
                }.font(.system(size: 11.5)).lineLimit(1)
            }
        }.padding(.vertical, 7)
    }
}
extension View {
    /** The link hand over things that can be pressed (macOS 15 and later; older systems keep the arrow). */
    // The pointer style API arrived with the macOS 15 SDK. An older toolchain does not know the name at all, so it gets a
    // version of this function that leaves the view alone, and the file still compiles there.
    #if compiler(>=6.0)
    @ViewBuilder func linkPointer(_ on: Bool = true) -> some View { if #available(macOS 15.0, *) { self.pointerStyle(on ? .link : .default) } else { self } }
    #else
    func linkPointer(_ on: Bool = true) -> some View { self }
    #endif
}
/**
 * A plain button that shows it can be pressed: a wash comes over it while the pointer is on it, a stronger one while it is
 * held, and the pointer turns into the link hand. `grow` lets the wash reach past the label without moving the layout,
 * `off` is for a choice that is already selected, and `lit` draws the hovered state for a capture.
 */
struct HoverStyle: ButtonStyle {
    var radius: CGFloat = 6; var grow: CGFloat = 0; var lit = false; var off = false
    func makeBody(configuration: Configuration) -> some View { HoverWash(c: configuration, radius: radius, grow: grow, lit: lit, off: off) }
}
struct HoverWash: View {
    let c: ButtonStyleConfiguration; let radius: CGFloat; let grow: CGFloat; let lit: Bool; let off: Bool
    @State private var over = false
    @Environment(\.isEnabled) private var enabled
    var body: some View {
        let live = enabled && !off
        c.label
            .overlay(RoundedRectangle(cornerRadius: radius).fill(Color.primary.opacity(!live ? 0 : c.isPressed ? 0.22 : (over || lit) ? 0.14 : 0)).padding(-grow).allowsHitTesting(false))
            .onHover { over = $0 }
            .animation(.easeOut(duration: 0.10), value: over)
            .linkPointer(live)
    }
}
/** A whole area that can be pressed and may hold buttons of its own (a button inside a button does not get its clicks). Same hover wash and pointer as HoverStyle. */
struct Pressable<Content: View>: View {
    var radius: CGFloat = 8; var lit = false; let action: () -> Void; @ViewBuilder var content: Content
    @State private var over = false
    var body: some View {
        content.overlay(RoundedRectangle(cornerRadius: radius).fill(Color.primary.opacity((over || lit) ? 0.09 : 0)).allowsHitTesting(false))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Color.primary.opacity((over || lit) ? 0.45 : 0), lineWidth: 1).allowsHitTesting(false))
            .contentShape(Rectangle()).onTapGesture(perform: action).onHover { over = $0 }.animation(.easeOut(duration: 0.10), value: over).linkPointer()
    }
}
/** A dot that keeps sending out a ring: something is running right now. */
struct LiveDot: View {
    let color: Color
    @State private var on = false
    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7).overlay(Circle().stroke(color.opacity(0.55), lineWidth: 2).scaleEffect(on ? 2.4 : 1).opacity(on ? 0 : 1))
            .frame(width: 12, height: 12)
            .onAppear { withAnimation(.easeOut(duration: 1.3).repeatForever(autoreverses: false)) { on = true } }
    }
}
// Controls drawn here, not AppKit's: they match the panel and they show up in a rendered capture.
struct Switch: View {
    let on: Bool; var disabled = false; let flip: () -> Void
    var body: some View {
        Button(action: flip) {
            ZStack(alignment: on ? .trailing : .leading) {
                Capsule().fill(on ? Color.accentColor : Color.primary.opacity(0.22)).frame(width: 36, height: 21)
                Circle().fill(Color.white).frame(width: 17, height: 17).padding(2).shadow(color: Color.black.opacity(0.3), radius: 0.8, y: 0.5)
            }.contentShape(Rectangle())
        }.buttonStyle(HoverStyle(radius: 12, grow: 3)).disabled(disabled).opacity(disabled ? 0.4 : 1).animation(.easeOut(duration: 0.14), value: on)
    }
}
struct Segments: View {
    let options: [Opt]; let selected: String; var disabled = false; let pick: (String) -> Void
    var body: some View {
        HStack(spacing: 2) {
            ForEach(options) { o in
                Button(action: { if o.id != selected { pick(o.id) } }) {
                    Text(o.label).font(.system(size: 12, weight: o.id == selected ? .semibold : .regular)).lineLimit(1).frame(maxWidth: .infinity).padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 5).fill(o.id == selected ? Color.primary.opacity(0.24) : Color.clear)).contentShape(Rectangle())
                }.buttonStyle(HoverStyle(radius: 5, off: o.id == selected))
            }
        }.padding(2).background(RoundedRectangle(cornerRadius: 7).fill(Color.primary.opacity(0.09))).disabled(disabled).opacity(disabled ? 0.4 : 1)
    }
}
struct SettingRow<Control: View>: View {
    let label: String; var caption: String = ""; @ViewBuilder var control: Control
    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 12.5))
                if !caption.isEmpty { Text(caption).font(.system(size: 10.5)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 4)
            control
        }.padding(.top, 3)
    }
}
struct SettingsView: View {
    @ObservedObject var prefs: Prefs
    var still = false  // a rendered capture cannot draw a live text field, so it gets a drawn one
    var back: () -> Void = {}
    let levels = [Opt("0", "자세히"), Opt("1", "기본"), Opt("2", "간략"), Opt("3", "최소")]
    let levelNotes = ["라벨을 길게 풀어 쓰고 모든 칩을 표시합니다", "라벨을 줄이고 모든 칩을 표시합니다", "캐시 적중률과 버전 칩을 빼고 절감 요약 줄을 접습니다", "한도와 컨텍스트와 캐시 만료와 경고만 남깁니다"]
    func compactText(_ c: CompactS) -> String { c.auto ? "모델 기본값" : c.value.map { "\(Int($0 / 1000))k" } ?? "설정 안 됨" }
    func compactNote(_ c: CompactS) -> String {
        if !c.is1m { return "지금 모델은 200k 컨텍스트라 이 값의 영향이 없습니다" }
        if c.reason == "unset" { return "값이 없어 약 97만 토큰에서야 압축이 걸립니다. \(Int(c.min / 1000))k에서 \(Int(c.max / 1000))k 사이를 권장합니다" }
        if c.reason == "too-large" { return "값이 커서 압축이 늦게 걸립니다. \(Int(c.min / 1000))k에서 \(Int(c.max / 1000))k 사이를 권장합니다" }
        switch c.source {
        case "global": return c.modelKey.map { "전역 설정의 모델별 값(\($0))에서 읽었습니다" } ?? "전역 설정(~/.claude/settings.json)에서 읽었습니다"
        case "project": return "전역 설정(~/.claude/settings.json)에서 읽었습니다"  // the app runs in the home folder, whose project file is the global one
        case "env": return "환경 변수 CLAUDE_CODE_AUTO_COMPACT_WINDOW에서 읽었습니다. 이 값이 설정 파일보다 앞섭니다"
        default: return "컨텍스트가 이 크기에 이르면 Claude Code가 대화를 자동으로 요약합니다"
        }
    }
    func clock(_ ms: Double?) -> String {
        guard let ms = ms else { return "" }
        let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR"); f.dateFormat = "M월 d일 HH:mm"
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Button(action: back) {
                    HStack(spacing: 5) { Image(systemName: "chevron.left").font(.system(size: 13, weight: .semibold)); Text("설정").font(.system(size: 15, weight: .medium)) }.frame(height: 22).contentShape(Rectangle())
                }.buttonStyle(HoverStyle(radius: 6, grow: 5))
                Spacer()
                if prefs.working { Text("적용 중").font(.system(size: 11.5)).foregroundColor(.secondary) }
            }.padding(.horizontal, 4)
            if let s = prefs.s {
                VStack(spacing: 0) {
                    Block(symbol: "arrow.triangle.branch", title: "모델 위임") {
                        SettingRow(label: "하위 모델에 위임", caption: "끄면 다음 세션부터 위임 룰과 힌트를 뺍니다. 등록한 룰은 보관됩니다") {
                            Switch(on: s.routing.enabled, disabled: prefs.working) { prefs.setRouting(!s.routing.enabled) }
                        }
                        SettingRow(label: "한도 창이 끝날 때까지 넓히기", caption: s.routing.relaxed ? "\(clock(s.routing.relaxUntil))까지 위임 범위를 넓힙니다" : "한도가 빠듯할 때 하위 모델에 더 많이 맡깁니다") {
                            Switch(on: s.routing.relaxed, disabled: prefs.working || !s.routing.enabled) { prefs.setRelax(!s.routing.relaxed) }
                        }
                    }
                    Divider().padding(.horizontal, 12)
                    Block(symbol: "rectangle.bottomthird.inset.filled", title: "상태줄") {
                        Text("표시 단계").font(.system(size: 12.5)).padding(.top, 3)
                        Segments(options: levels, selected: String(s.statusline.compact), disabled: prefs.working) { prefs.setLevel(Int($0) ?? 0) }
                        Text(levelNotes[min(3, max(0, s.statusline.compact))]).font(.system(size: 10.5)).foregroundColor(.secondary)
                        if let sample = prefs.samples[min(3, max(0, s.statusline.compact))] {
                            // What this level looks like, in the CLI's own demo render: the labels alone did not say.
                            VStack(alignment: .leading, spacing: 3) {
                                Text("이 단계의 예시").font(.system(size: 10, weight: .medium)).foregroundColor(.secondary)
                                Text(sample).font(.system(size: 10, design: .monospaced)).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(8).background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.28)))
                        }
                        Text("라벨").font(.system(size: 12.5)).padding(.top, 5)
                        Segments(options: [Opt("icon", "아이콘"), Opt("narrow", "좁은 기호"), Opt("text", "글자")], selected: s.statusline.labels, disabled: prefs.working) { prefs.setLabels($0) }
                        SettingRow(label: "캐시 타이머", caption: "캐시가 만료될 때까지 남은 시간을 표시합니다") {
                            Switch(on: s.statusline.timer, disabled: prefs.working) { prefs.setTimer(!s.statusline.timer) }
                        }
                    }
                    if let c = s.compactWindow {
                        Divider().padding(.horizontal, 12)
                        Block(symbol: "arrow.down.right.and.arrow.up.left", title: "자동 압축 시점: \(compactText(c))") {
                            Text(compactNote(c)).font(.system(size: 10.5)).foregroundColor(c.is1m && !c.ok ? .orange : .secondary).fixedSize(horizontal: false, vertical: true)
                            Segments(options: [Opt("400000", "400k"), Opt("500000", "500k 권장"), Opt("600000", "600k"), Opt("700000", "700k")], selected: c.value.map { String(Int($0)) } ?? "", disabled: prefs.working) { prefs.pendingCompact = Int($0); RELAYOUT() }.padding(.top, 2)
                            if let n = prefs.pendingCompact {
                                HStack(alignment: .center, spacing: 8) {
                                    Text("전역 설정의 모든 모델에 \(n / 1000)k를 적용합니다. 같은 파일의 모델별 값은 지워집니다").font(.system(size: 11)).fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 4)
                                    Pill("취소") { prefs.pendingCompact = nil; RELAYOUT() }
                                    Pill("적용", .accent, disabled: prefs.working) { prefs.setCompact(n) }
                                }.padding(8).background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.08)))
                            }
                            SettingRow(label: "값이 없거나 크면 알림", caption: "1M 컨텍스트일 때 상태줄과 세션 시작 안내로 알립니다") {
                                Switch(on: c.warn, disabled: prefs.working) { prefs.setCompactWarn(!c.warn) }
                            }
                        }
                    }
                    Divider().padding(.horizontal, 12)
                    Block(symbol: "building.2", title: "타운") {
                        if s.team.joined {
                            if let t = s.team.teamName { Text("팀: \(t)").font(.system(size: 12)).foregroundColor(.secondary) }
                            Text("표시 이름").font(.system(size: 12.5)).padding(.top, 3)
                            HStack(spacing: 8) {
                                if still {
                                    Text(prefs.nameDraft).font(.system(size: 13)).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 7).padding(.vertical, 4)
                                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.10))).overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.18), lineWidth: 1))
                                } else {
                                    TextField("타운에 보일 이름", text: $prefs.nameDraft).textFieldStyle(.plain).font(.system(size: 13)).padding(.horizontal, 7).padding(.vertical, 4)
                                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.10))).overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.18), lineWidth: 1))
                                        .onSubmit { prefs.rename() }.disabled(prefs.working)
                                }
                                Button(action: { prefs.rename() }) {
                                    Text("저장").font(.system(size: 12, weight: .medium)).padding(.horizontal, 12).padding(.vertical, 5)
                                        .background(RoundedRectangle(cornerRadius: 6).fill(prefs.nameChanged ? Color.accentColor : Color.primary.opacity(0.12))).foregroundColor(prefs.nameChanged ? .white : .secondary)
                                }.buttonStyle(HoverStyle(radius: 6)).disabled(!prefs.nameChanged || prefs.working)
                            }
                            Text("타운과 팀 대시보드에 이 이름으로 나옵니다").font(.system(size: 10.5)).foregroundColor(.secondary)
                            Button(action: { prefs.openTown() }) {
                                HStack(spacing: 5) { Image(systemName: "arrow.up.right.square"); Text("타운 열기") }.font(.system(size: 12, weight: .medium)).padding(.horizontal, 10).padding(.vertical, 5)
                                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.12))).contentShape(Rectangle())
                            }.buttonStyle(HoverStyle(radius: 6)).disabled(prefs.working).padding(.top, 4)
                        } else {
                            Text("팀에 참여하지 않았습니다. 터미널에서 sprag team join 으로 참여하면 이름을 정할 수 있습니다").font(.system(size: 12)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Divider().padding(.horizontal, 12)
                    Block(symbol: "globe", title: "안내문 언어") {
                        Segments(options: [Opt("ko", "한국어"), Opt("en", "English")], selected: s.language, disabled: prefs.working) { prefs.setLanguage($0) }.padding(.top, 2)
                    }
                }.background(RoundedRectangle(cornerRadius: 12).fill(CARD_FILL)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.primary.opacity(0.10), lineWidth: 1))
            } else {
                Text(prefs.failed ? prefs.note : "설정을 불러오는 중입니다").font(.system(size: 12.5)).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 26)
            }
            if prefs.s != nil && !prefs.note.isEmpty {
                Text(prefs.note).font(.system(size: 11.5)).foregroundColor(prefs.failed ? .orange : .secondary).lineLimit(3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 6)
            }
        }.padding(12).frame(width: 408)
    }
}
enum PillKind { case plain, accent, danger }
struct Pill: View {
    let title: String; let kind: PillKind; let disabled: Bool; let action: () -> Void
    init(_ title: String, _ kind: PillKind = .plain, disabled: Bool = false, action: @escaping () -> Void) { self.title = title; self.kind = kind; self.disabled = disabled; self.action = action }
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 11.5, weight: .medium)).padding(.horizontal, 10).padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 6).fill(kind == .accent ? Color.accentColor : kind == .danger ? Color.red.opacity(0.85) : Color.primary.opacity(0.14)))
                .foregroundColor(kind == .plain ? Color.primary : Color.white).contentShape(Rectangle())
        }.buttonStyle(HoverStyle(radius: 6)).disabled(disabled).opacity(disabled ? 0.45 : 1).fixedSize()
    }
}
struct HeightKey: PreferenceKey { static var defaultValue: CGFloat = 0; static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) } }
/** A scroll view as tall as its content, up to a limit. A scroll view has no height of its own, so the content is measured. */
struct FitScroll<Content: View>: View {
    let limit: CGFloat; var still = false; @ViewBuilder var content: Content
    @State private var height: CGFloat = 160
    var body: some View {
        if still { content } else {
            ScrollView { content.background(GeometryReader { g in Color.clear.preference(key: HeightKey.self, value: g.size.height) }) }
                .frame(height: min(max(height, 40), limit))
                .onPreferenceChange(HeightKey.self) { h in if abs(h - height) > 0.5 { height = h; RELAYOUT() } }
        }
    }
}
struct PageHead: View {
    let title: String; var busy = false; let back: () -> Void
    var body: some View {
        HStack(spacing: 6) {
            Button(action: back) {
                HStack(spacing: 5) { Image(systemName: "chevron.left").font(.system(size: 13, weight: .semibold)); Text(title).font(.system(size: 15, weight: .medium)) }.frame(height: 22).contentShape(Rectangle())
            }.buttonStyle(HoverStyle(radius: 6, grow: 5))
            Spacer()
            if busy { Text("적용 중").font(.system(size: 11.5)).foregroundColor(.secondary) }
        }.padding(.horizontal, 4)
    }
}
let CARD = RoundedRectangle(cornerRadius: 12)
/** The warnings the statusline is showing, at the top of the panel. A row opens the detail page. */
struct WarningList: View {
    let warnings: [Warn]; let open: (Warn) -> Void
    var body: some View {
        let crit = warnings.contains { $0.level == "critical" }
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 21)).foregroundColor(crit ? .red : .orange).frame(width: 34, height: 26)
            VStack(alignment: .leading, spacing: 6) {
                Text("경고 \(warnings.count)건").font(.system(size: 15.5, weight: .semibold))
                ForEach(warnings) { w in
                    Button(action: { open(w) }) {
                        HStack(alignment: .firstTextBaseline, spacing: 7) {
                            Text(w.chip).font(.system(size: 12.5, weight: .semibold)).foregroundColor(w.level == "critical" ? .red : .orange).fixedSize()
                            Text(w.advice?.first?.title ?? "").font(.system(size: 12)).lineLimit(1).truncationMode(.tail)
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundColor(.secondary)
                        }.contentShape(Rectangle())
                    }.buttonStyle(HoverStyle(radius: 6, grow: 5))
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.vertical, 11).padding(.horizontal, 12)
    }
}
struct CommandBox: View {
    let lines: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in Text(l).font(.system(size: 11, design: .monospaced)).fixedSize(horizontal: false, vertical: true).textSelection(.enabled) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(8).background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.08)))
    }
}
struct AdviceView: View {
    let a: Advice
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let t = a.title { Text(t).font(.system(size: 13.5, weight: .semibold)).fixedSize(horizontal: false, vertical: true) }
            if let e = a.explain { Text(e).font(.system(size: 12)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true) }
            ForEach(Array((a.actions ?? []).enumerated()), id: \.offset) { _, act in
                if let l = act.label { Text(l).font(.system(size: 12, weight: .medium)).fixedSize(horizontal: false, vertical: true).padding(.top, 3) }
                if let c = act.commands, !c.isEmpty { CommandBox(lines: c) }
            }
            if (a.actions ?? []).isEmpty, let tip = a.tip { Text(tip).font(.system(size: 12)).fixedSize(horizontal: false, vertical: true) }
        }
    }
}
/** One warning in full: what it is, since when, and what to do about it, as `sprag last` would print. */
struct WarningView: View {
    let w: Warn?; let now: Double; var limit: CGFloat = 800; var still = false; var back: () -> Void = {}
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PageHead(title: "경고", back: back)
            if let w = w {
                let tint: Color = w.level == "critical" ? .red : .orange
                let when = [w.since.map { "\(sinceText($0, now: now)) 표시 중" } ?? "", resetText(w.resetsAt, now: now)].filter { !$0.isEmpty }.joined(separator: ", ")
                FitScroll(limit: limit - 70, still: still) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(w.chip).font(.system(size: 17, weight: .semibold)).foregroundColor(tint)
                        if let d = w.detail { Text(d).font(.system(size: 12.5)).fixedSize(horizontal: false, vertical: true) }
                        if !when.isEmpty { Text(when).font(.system(size: 11.5)).foregroundColor(.secondary) }
                        ForEach(w.advice ?? []) { a in Divider(); AdviceView(a: a) }
                        if (w.advice ?? []).isEmpty { Text("이 경고에 등록된 안내문이 없습니다. 터미널에서 sprag last 로 확인할 수 있습니다").font(.system(size: 12)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true) }
                    }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                }.background(CARD.fill(CARD_FILL)).overlay(CARD.stroke(Color.primary.opacity(0.10), lineWidth: 1))
            } else {
                Text("이 경고는 해소됐습니다").font(.system(size: 12.5)).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 26)
            }
        }.padding(12).frame(width: 408)
    }
}
/** One rule: two lines until it is clicked, then the whole text and its buttons. Removal takes a second click. */
/** The dates a rule line starts with ("2026-08-01: 2026-08-01: ..."): the first one, and the text without them. */
func splitRuleDate(_ text: String) -> (date: String?, body: String) {
    var rest = Substring(text), first: String? = nil
    while rest.count > 11 {
        let head = rest.prefix(10), parts = head.split(separator: "-")
        guard parts.count == 3, parts[0].count == 4, parts.allSatisfy({ $0.allSatisfy { $0.isNumber } }), rest.dropFirst(10).first == ":" else { break }
        if first == nil { first = String(head) }
        rest = rest.dropFirst(11).drop { $0 == " " }
    }
    return (first, String(rest))
}
struct RuleLine: View {
    @ObservedObject var book: RuleBook
    let id: String; let tag: String; let text: String
    var detail = ""; var extra = ""
    var removeLabel: String? = "삭제"; var removeNote = ""; var remove: () -> Void = {}
    var second: String? = nil; var secondAction: () -> Void = {}
    var body: some View {
        let open = book.expanded == id
        VStack(alignment: .leading, spacing: 5) {
            Button(action: { book.expanded = open ? nil : id; book.confirm = nil; RELAYOUT() }) {
                // The whole rule, always: a rule cut after two lines says nothing. Its date moves under the number so the text starts with the rule.
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(tag).font(.system(size: 11, weight: .semibold, design: .monospaced)).foregroundColor(.secondary)
                        if let d = splitRuleDate(text).date { Text(d.dropFirst(5)).font(.system(size: 9.5, design: .monospaced)).foregroundColor(.secondary).help(d) }
                    }.frame(width: 38, alignment: .leading)
                    Text(splitRuleDate(text).body).font(.system(size: 12)).lineSpacing(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: open ? "chevron.up" : "ellipsis").font(.system(size: 11, weight: .semibold)).foregroundColor(.secondary).frame(width: 16, height: 16).help(open ? "접기" : "삭제 같은 동작 보기")
                }.contentShape(Rectangle())
            }.buttonStyle(HoverStyle(radius: 6, grow: 4))
            if open {
                if !detail.isEmpty { Text(detail).font(.system(size: 11)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true).padding(.leading, 46).textSelection(.enabled) }
                if !extra.isEmpty { Text(extra).font(.system(size: 10.5)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true).padding(.leading, 46) }
                if removeLabel != nil || second != nil {
                    HStack(spacing: 8) {
                        Spacer(minLength: 0)
                        if book.confirm == id {
                            Text(removeNote).font(.system(size: 10.5)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
                            Pill("취소") { book.confirm = nil; RELAYOUT() }
                            Pill("\(removeLabel ?? "삭제") 확인", .danger, disabled: book.working) { remove() }
                        } else {
                            if let s = second { Pill(s, .accent, disabled: book.working) { secondAction() } }
                            if let r = removeLabel { Pill(r, disabled: book.working) { book.confirm = id; RELAYOUT() } }
                        }
                    }
                }
            }
        }.padding(.vertical, 5)
    }
}
struct RuleGroup<Content: View>: View {
    @ObservedObject var book: RuleBook
    let id: String; let symbol: String; let title: String; let count: Int
    var sub = ""; var warn = false
    @ViewBuilder var content: Content
    var body: some View {
        let open = book.open.contains(id)
        VStack(alignment: .leading, spacing: 0) {
            Button(action: { if open { book.open.remove(id) } else { book.open.insert(id) }; RELAYOUT() }) {
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: symbol).font(.system(size: 17)).frame(width: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 6) {
                            Text(title).font(.system(size: 13.5, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                            Text("\(count)").font(.system(size: 11, weight: .semibold)).monospacedDigit().padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(Color.primary.opacity(0.14)))
                        }
                        if !sub.isEmpty { Text(sub).font(.system(size: 10.5)).foregroundColor(warn ? .orange : .secondary).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true) }
                    }
                    Spacer(minLength: 4)
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 10.5, weight: .semibold)).foregroundColor(.secondary)
                }.padding(.vertical, 9).padding(.horizontal, 12).contentShape(Rectangle())
            }.buttonStyle(HoverStyle(radius: 8))
            if open { VStack(alignment: .leading, spacing: 0) { content }.padding(.horizontal, 12).padding(.bottom, 8) }
        }
    }
}
struct AddRule: View {
    @ObservedObject var book: RuleBook
    let id: String; var still = false; let add: (String) -> Void
    var body: some View {
        let text = book.drafts[id] ?? ""
        let ok = text.trimmingCharacters(in: .whitespaces).count >= 8 && text.trimmingCharacters(in: .whitespaces).contains(" ")
        let box = RoundedRectangle(cornerRadius: 6)
        HStack(spacing: 8) {
            if still {
                Text(text.isEmpty ? "조건이면 행동, 한 줄로 적습니다" : text).font(.system(size: 12)).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 7).padding(.vertical, 4)
                    .background(box.fill(Color.primary.opacity(0.10))).overlay(box.stroke(Color.primary.opacity(0.18), lineWidth: 1))
            } else {
                TextField("조건이면 행동, 한 줄로 적습니다", text: Binding(get: { book.drafts[id] ?? "" }, set: { book.drafts[id] = $0 })).textFieldStyle(.plain).font(.system(size: 12)).padding(.horizontal, 7).padding(.vertical, 4)
                    .background(box.fill(Color.primary.opacity(0.10))).overlay(box.stroke(Color.primary.opacity(0.18), lineWidth: 1))
                    .onSubmit { if ok { add(text) } }.disabled(book.working)
            }
            Pill("추가", .accent, disabled: !ok || book.working) { add(text) }
        }.padding(.top, 7)
    }
}
/** Every rule source in one place: what is loaded into each session, and the buttons the CLI already has for it. */
struct RulesView: View {
    @ObservedObject var book: RuleBook
    var limit: CGFloat = 800; var still = false; var back: () -> Void = {}
    func num(_ n: Int) -> String { let f = NumberFormatter(); f.numberStyle = .decimal; return f.string(from: NSNumber(value: n)) ?? "\(n)" }
    func fileNote(_ exists: Bool, _ tokens: Int, _ budget: Int) -> String {
        if !exists { return "파일이 아직 없습니다" }
        return "약 \(num(tokens)) 토큰이 모든 요청에 실립니다" + (tokens > budget ? ". 권장 \(num(budget)) 토큰을 넘었습니다" : "")
    }
    func ratchetRows(_ rules: [RuleItem], scope: String, root: String?, key: String) -> some View {
        Group {
            AddRule(book: book, id: key, still: still) { book.addRatchet(scope: scope, root: root, key: key, text: $0) }
            Divider()
            ForEach(rules, id: \.index) { r in
                RuleLine(book: book, id: "\(key)#\(r.index)", tag: "#\(r.index)", text: r.text, removeNote: "지우기 전 내용은 ratchet.md.bak 에 남깁니다", remove: { book.removeRatchet(scope: scope, root: root, index: r.index, text: r.text) })
                if r.index != rules.last?.index { Divider() }
            }
        }
    }
    func modelExtra(_ r: ModelRule) -> String {
        var parts: [String] = [r.scope == "project" ? "프로젝트 \(r.root.map { ($0 as NSString).lastPathComponent } ?? "")" : "전역"]
        if r.status == "review" { parts.append("오류율이 기준을 넘어 재검토 필요") }
        if let c = r.count, c > 0 { parts.append("반복 \(Int(c))회") }
        if let s = r.savedUsd, s > 0 { parts.append(String(format: "절감 약 $%.0f", s)) }
        return parts.joined(separator: ", ")
    }
    func groups(_ d: Rules) -> some View {
        VStack(spacing: 0) {
            RuleGroup(book: book, id: "global", symbol: "globe", title: "전역 래칫", count: d.global.rules.count, sub: fileNote(d.global.exists, d.global.tokens, d.budgetTokens), warn: d.global.tokens > d.budgetTokens) {
                ratchetRows(d.global.rules, scope: "global", root: nil, key: "global")
            }
            ForEach(d.projects, id: \.root) { p in
                Divider().padding(.horizontal, 12)
                RuleGroup(book: book, id: "project:\(p.root)", symbol: "folder", title: p.name, count: p.rules.count, sub: "프로젝트 래칫. " + fileNote(p.exists, p.tokens, d.budgetTokens), warn: p.tokens > d.budgetTokens) {
                    ratchetRows(p.rules, scope: "project", root: p.root, key: "project:\(p.root)")
                }
            }
            Divider().padding(.horizontal, 12)
            RuleGroup(book: book, id: "preset", symbol: "shippingbox", title: "프리셋", count: d.preset.rules.count, sub: d.preset.pending.isEmpty ? "sprag에 동봉된 추천 룰 가운데 전역으로 등록한 것입니다" : "아직 답하지 않은 추천이 \(d.preset.pending.count)개 있습니다") {
                ForEach(d.preset.pending, id: \.id) { r in
                    RuleLine(book: book, id: "pending:\(r.id)", tag: "추천", text: r.text, extra: r.id, removeLabel: "건너뛰기", removeNote: "다시 권하지 않습니다", remove: { book.skipPreset(r.id) }, second: "전역 등록", secondAction: { book.acceptPreset(r.id) })
                    Divider()
                }
                ForEach(d.preset.rules, id: \.id) { r in
                    RuleLine(book: book, id: "preset:\(r.id)", tag: "등록", text: r.text, extra: r.id, removeLabel: "빼기", removeNote: "프리셋 파일에서 빼고 다시 권하지 않습니다", remove: { book.skipPreset(r.id) })
                    Divider()
                }
            }
            Divider().padding(.horizontal, 12)
            RuleGroup(book: book, id: "model", symbol: "arrow.triangle.branch", title: "모델 위임 룰", count: d.model.rules.count, sub: d.model.enabled ? "작업 기록을 보고 자동으로 갱신하는 룰입니다" : "모델 위임이 꺼져 있어 지금은 적용되지 않습니다", warn: !d.model.enabled) {
                ForEach(d.model.rules, id: \.index) { r in
                    RuleLine(book: book, id: "model#\(r.index)", tag: r.tier ?? "#\(r.index)", text: r.label ?? r.text, detail: r.text, extra: modelExtra(r), removeNote: "등록부에서 지웁니다. 되돌리려면 다시 등록해야 합니다", remove: { book.removeModel(index: r.index, text: r.text) })
                    Divider()
                }
            }
            Divider().padding(.horizontal, 12)
            RuleGroup(book: book, id: "team", symbol: "person.2", title: "조직과 팀 규칙", count: d.team.rules.count, sub: !d.team.joined ? "팀에 참여하지 않았습니다" : d.team.rules.isEmpty ? "관리자가 내려보낸 규칙이 없습니다" : "관리자가 정한 규칙이라 여기서는 볼 수만 있습니다") {
                ForEach(Array(d.team.rules.enumerated()), id: \.offset) { i, r in
                    RuleLine(book: book, id: "team:\(i)", tag: r.level == "org" ? "조직" : "팀", text: r.text, extra: r.scope == "model" ? "모델 위임 규칙" : "래칫 규칙", removeLabel: nil)
                    Divider()
                }
            }
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PageHead(title: "규칙", busy: book.working, back: back)
            if let d = book.data {
                FitScroll(limit: limit - 96, still: still) { groups(d) }
                    .background(CARD.fill(CARD_FILL)).overlay(CARD.stroke(Color.primary.opacity(0.10), lineWidth: 1))
            } else {
                Text(book.failed ? book.note : "규칙을 불러오는 중입니다").font(.system(size: 12.5)).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 26)
            }
            if book.data != nil && !book.note.isEmpty {
                Text(book.note).font(.system(size: 11.5)).foregroundColor(book.failed ? .orange : .secondary).lineLimit(3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 6)
            }
        }.padding(12).frame(width: 408)
    }
}
struct ToolLine: View {
    let c: ToolCall; let now: Double
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Circle().fill(c.pending == true ? Color.green : Color.primary.opacity(0.25)).frame(width: 5, height: 5).offset(y: -2)
            Text(toolName(c.tool)).font(.system(size: 11, weight: .medium, design: .monospaced)).lineLimit(1).fixedSize()
            Text(c.target ?? "").font(.system(size: 11)).foregroundColor(.secondary).lineLimit(4).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Text(c.pending == true ? "실행 중" : agoText(c.at, now: now)).font(.system(size: 10)).foregroundColor(c.pending == true ? .green : .secondary).fixedSize()
        }
    }
}
/** What a session is working on: the request, the last reply, the recent tool calls and the heaviest child processes. */
struct WorkSummary: View {
    let d: Detail?; let now: Double
    var textLines = 5; var calls = 8; var procs = 5; var off = false
    func head(_ title: String, _ side: String = "") -> some View {
        HStack { Text(title).font(.system(size: 10.5, weight: .semibold)).foregroundColor(.secondary); Spacer(); Text(side).font(.system(size: 10)).foregroundColor(.secondary) }.padding(.top, 3)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let d = d {
                head("요청", agoText(d.prompt?.at, now: now))
                Text(d.prompt?.text ?? "최근 기록에서 요청을 찾지 못했습니다").font(.system(size: 12)).foregroundColor(d.prompt == nil ? .secondary : .primary).lineLimit(textLines).fixedSize(horizontal: false, vertical: true)
                if let r = d.reply {
                    head("마지막 응답", agoText(r.at, now: now))
                    Text(r.text).font(.system(size: 11.5)).foregroundColor(.secondary).lineLimit(textLines).fixedSize(horizontal: false, vertical: true)
                }
                let recent = Array((d.recent ?? []).suffix(calls).reversed())
                if !recent.isEmpty {
                    head("최근 도구 호출")
                    ForEach(Array(recent.enumerated()), id: \.offset) { _, c in ToolLine(c: c, now: now) }
                }
                let ps = Array((d.procs ?? []).prefix(procs))
                if !ps.isEmpty {
                    head("자식 프로세스")
                    ForEach(ps, id: \.pid) { p in
                        HStack(spacing: 6) {
                            Text(p.name).font(.system(size: 11, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 4)
                            Text(p.cpuPct.map { pct1($0) } ?? "-").font(.system(size: 11)).monospacedDigit().frame(width: 46, alignment: .trailing)
                            Text(memText(p.rssMb)).font(.system(size: 11)).monospacedDigit().foregroundColor(.secondary).frame(width: 58, alignment: .trailing)
                        }
                    }
                }
            } else {
                Text(off ? "이 sprag 버전은 세션 상세를 내지 않습니다" : "상세를 불러오는 중입니다").font(.system(size: 11.5)).foregroundColor(.secondary).padding(.vertical, 6)
            }
        }
    }
}
struct Fact: View {
    let label: String; let value: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).foregroundColor(.secondary).frame(width: 62, alignment: .leading)
            Text(value).monospacedDigit().fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }.font(.system(size: 11.5))
    }
}
func tokenLine(_ u: SUsage) -> String { "입력 \(tokText(u.tokens.input)), 캐시 읽기 \(tokText(u.tokens.cacheRead)), 캐시 쓰기 \(tokText(u.tokens.cacheWrite)), 출력 \(tokText(u.tokens.output))" }
/** The tooltip of the compaction mark: each pass replaces the earlier conversation with a summary. */
func compactionTip(_ n: Int) -> String { "이 세션에서 대화가 \(n)번 압축됐습니다. 압축될 때마다 앞에서 정한 내용이 요약으로 줄어듭니다" }
func contextLine(_ c: Ctx) -> String { c.pct.map { "\(Int($0))% (\(tokText(c.tokens))" + (c.window.map { " / \(tokText($0)))" } ?? ")") } ?? tokText(c.tokens) }
/** One session in full, opened by clicking its row. */
struct SessionView: View {
    let s: Session?; let cpu: Double; let mem: Double; let now: Double
    var off = false; var limit: CGFloat = 800; var still = false; var back: () -> Void = {}
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PageHead(title: "세션", back: back)
            if let s = s {
                FitScroll(limit: limit - 70, still: still) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 7) { Badge(agent: s.agent); Text(s.label).font(.system(size: 15, weight: .semibold)).lineLimit(1).truncationMode(.middle) }
                        if let c = s.cwd { Text(c).font(.system(size: 10.5, design: .monospaced)).foregroundColor(.secondary).lineLimit(1).truncationMode(.head).textSelection(.enabled) }
                        HStack(spacing: 6) { Circle().fill(stateColor(s)).frame(width: 7, height: 7); Text(activity(s, now: now)).font(.system(size: 12)) }
                        Divider().padding(.vertical, 2)
                        Fact(label: "모델", value: [s.modelName ?? s.model ?? "알 수 없음", s.effort.map { "effort \($0)" } ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
                        if let c = s.context { Fact(label: "컨텍스트", value: contextLine(c)) }
                        if let n = s.compactions, n >= 1 { Fact(label: "압축", value: "\(n)번") }
                        if let u = s.usage {
                            Fact(label: "토큰", value: tokenLine(u))
                            Fact(label: "비용", value: [u.costUsd.map { String(format: "$%.2f (정가 환산)", $0) } ?? "가격표 없음", u.requests.map { "요청 \(Int($0))회" } ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
                        }
                        Fact(label: "자원", value: s.cpu == nil ? "측정 못 함" : "CPU \(pct1(cpu)) (기기 전체 기준), 메모리 \(memText(mem)), 프로세스 \(s.procs ?? 0)개")
                        Fact(label: "PID", value: String(s.pid))
                        Divider().padding(.vertical, 2)
                        WorkSummary(d: s.detail, now: now, off: off)
                    }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                }.background(CARD.fill(CARD_FILL)).overlay(CARD.stroke(Color.primary.opacity(0.10), lineWidth: 1))
            } else {
                Text("이 세션은 끝났습니다").font(.system(size: 12.5)).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 26)
            }
        }.padding(12).frame(width: 408)
    }
}
func hex(_ v: UInt32) -> Color { Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255) }
/** Chart colours: the two agent hues and the status steps, each chosen for its surface and checked for colour-blind separation and contrast. */
struct Pal {
    let dark: Bool
    var surface: Color { dark ? hex(0x1a1a19) : hex(0xfcfcfb) }
    var tile: Color { dark ? hex(0x2a2a29) : hex(0xefeeea) }
    var group: Color { dark ? hex(0x212120) : hex(0xf6f5f2) }   // the plate under one project's tiles, a step off the surface
    var well: Color { dark ? hex(0x313130) : hex(0xe6e5e1) }
    var text: Color { dark ? hex(0xf2f1ec) : hex(0x0b0b0b) }
    var text2: Color { dark ? hex(0xc3c2b7) : hex(0x52514e) }
    var neutral: Color { dark ? hex(0x8f8e86) : hex(0x8a8982) }   // a series that belongs to no agent, such as the whole machine
    var claude: Color { dark ? hex(0xd95926) : hex(0xeb6834) }
    var codex: Color { dark ? hex(0x199e70) : hex(0x1baf7a) }
    var left: Color { dark ? hex(0x9085e9) : hex(0x6250d6) }      // what ended sessions left running
    let warning = hex(0xfab219), critical = hex(0xd03b3b), good = hex(0x0ca30c)
    /** The colour of a state. The agent's own colour stays on its badge; it never says how a session is doing. */
    func state(_ p: Phase) -> Color { p == .active ? good : p == .needsUser ? warning : neutral }
    func agent(_ a: String) -> Color { a == "codex" ? codex : claude }
}
func spanText(_ from: Double?, _ to: Double?) -> String {
    guard let a = from, let b = to, b > a else { return "" }
    let sec = Int(b - a)
    return sec < 90 ? "최근 \(sec)초" : "최근 \(Int((Double(sec) / 60).rounded()))분"
}
func toolSymbol(_ t: String) -> String {
    switch t {
    case "Bash": return "terminal"
    case "Read": return "doc.text"
    case "Edit", "Write", "NotebookEdit": return "pencil"
    case "Grep", "Glob": return "magnifyingglass"
    case "Agent", "Task": return "person.2"
    case "WebSearch", "WebFetch": return "globe"
    case "Skill": return "sparkles"
    case "TodoWrite": return "checklist"
    default: return t.hasPrefix("mcp__") ? "puzzlepiece.extension" : "wrench.and.screwdriver"
    }
}
func stateMark(_ s: Session) -> (symbol: String, label: String) {
    switch s.state {
    case "busy": return ("bolt.fill", "작업 중")
    case "idle": return ("pause.circle", "입력 대기")
    case "shell": return ("terminal.fill", "셸 실행")
    case "waiting": return ("hand.raised.fill", "확인 대기")
    default: return ("questionmark.circle", s.state ?? "상태 모름")
    }
}
/** A trend line: 2 pt line over a faint wash, and a ringed dot on the newest value. Several series share one scale through `top`. */
struct Spark: View {
    let values: [Double]; let color: Color; let surface: Color
    var top: Double? = nil; var slots = 60; var dot = true
    var body: some View {
        GeometryReader { g in
            let hi = max(top ?? 0, values.max() ?? 0, 0.000001)
            let step = (g.size.width - 12) / CGFloat(max(1, slots - 1))
            let pts: [CGPoint] = values.enumerated().map { i, v in
                CGPoint(x: g.size.width - 6 - CGFloat(values.count - 1 - i) * step, y: 5 + (g.size.height - 10) * (1 - CGFloat(min(1, max(0, v / hi)))))
            }
            ZStack {
                if pts.count > 1 {
                    Path { p in p.move(to: CGPoint(x: pts[0].x, y: g.size.height)); for q in pts { p.addLine(to: q) }; p.addLine(to: CGPoint(x: pts[pts.count - 1].x, y: g.size.height)); p.closeSubpath() }.fill(color.opacity(0.10))
                    Path { p in p.move(to: pts[0]); for q in pts.dropFirst() { p.addLine(to: q) } }.stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                }
                if dot, let last = pts.last { Circle().fill(color).frame(width: 8, height: 8).overlay(Circle().stroke(surface, lineWidth: 2).frame(width: 10, height: 10)).position(last) }
            }
        }
    }
}
/**
 * A trend that can be read: the top and bottom of the scale are printed, the caption gives the time it covers and the
 * highest value in it, and every series has its name and latest value. The line always spans the whole width, so a
 * short history is a coarse line, not a sliver at one edge.
 */
struct TrendChart: View {
    struct Line: Identifiable { let id: String; let values: [Double]; let color: Color; var fill = false }
    let title: String; let lines: [Line]; let top: Double; let fmt: (Double) -> String; let span: String; let pal: Pal
    var height: CGFloat = 44
    func points(_ v: [Double], _ size: CGSize) -> [CGPoint] {
        guard v.count > 1 else { return [] }
        let step = size.width / CGFloat(v.count - 1), hi = max(top, 0.000001)
        return v.enumerated().map { i, x in CGPoint(x: CGFloat(i) * step, y: 1 + (size.height - 2) * (1 - CGFloat(min(1, max(0, x / hi))))) }
    }
    var body: some View {
        let peak = lines.first?.values.max() ?? 0
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(title).font(.system(size: 11.5, weight: .semibold)).foregroundColor(pal.text).fixedSize()
                ForEach(lines) { l in
                    HStack(spacing: 3) { Circle().fill(l.color).frame(width: 6, height: 6); Text("\(l.id) \(fmt(l.values.last ?? 0))").font(.system(size: 10.5)).monospacedDigit().foregroundColor(pal.text2) }.fixedSize()
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .top, spacing: 5) {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(fmt(top)).font(.system(size: 9.5)).monospacedDigit().foregroundColor(pal.text2)
                    Spacer(minLength: 0)
                    Text(fmt(0)).font(.system(size: 9.5)).monospacedDigit().foregroundColor(pal.text2)
                }.frame(width: 42, height: height, alignment: .trailing)
                GeometryReader { g in
                    ZStack {
                        Path { p in
                            p.move(to: CGPoint(x: 0, y: 0.5)); p.addLine(to: CGPoint(x: g.size.width, y: 0.5))
                            p.move(to: CGPoint(x: 0, y: g.size.height - 0.5)); p.addLine(to: CGPoint(x: g.size.width, y: g.size.height - 0.5))
                        }.stroke(pal.well, lineWidth: 1)
                        ForEach(lines) { l in
                            let pts = points(l.values, g.size)
                            if pts.count > 1 {
                                if l.fill { Path { p in p.move(to: CGPoint(x: pts[0].x, y: g.size.height)); for q in pts { p.addLine(to: q) }; p.addLine(to: CGPoint(x: pts[pts.count - 1].x, y: g.size.height)); p.closeSubpath() }.fill(l.color.opacity(0.12)) }
                                Path { p in p.move(to: pts[0]); for q in pts.dropFirst() { p.addLine(to: q) } }.stroke(l.color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                            }
                        }
                    }
                }.frame(height: height)
            }
            Text(span.isEmpty ? "값을 모으는 중입니다" : "\(span), 최고 \(fmt(peak))").font(.system(size: 9.5)).monospacedDigit().foregroundColor(pal.text2).padding(.leading, 47)
        }
    }
}
/** One ratio against a limit. The track is a lighter step of the fill's own hue, so the state reads along the whole bar. */
struct Meter: View {
    let value: Double; let fill: Color; var height: CGFloat = 8; var tick: Double? = nil; var tickColor: Color = .white
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(fill.opacity(0.24))
                if value > 0.0005 { Capsule().fill(fill).frame(width: max(3, g.size.width * CGFloat(min(1, max(0, value))))) }
                if let t = tick { Rectangle().fill(tickColor).frame(width: 2, height: height + 4).offset(x: g.size.width * CGFloat(min(1, max(0, t))) - 1) }
            }
        }.frame(height: height)
    }
}
/** What a use percentage means: past 90 it is critical, past 70 a warning. The colour never stands alone; `symbol` goes with it. */
func severity(_ pct: Double, _ base: Color, _ pal: Pal, warnAt: Double = 70, critAt: Double = 90) -> (color: Color, symbol: String?) {
    pct >= critAt ? (pal.critical, "exclamationmark.octagon.fill") : pct >= warnAt ? (pal.warning, "exclamationmark.triangle.fill") : (base, nil)
}
struct StatTile<Plot: View>: View {
    let label: String; let value: String; var note = ""; let pal: Pal; @ViewBuilder var plot: Plot
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 11)).foregroundColor(pal.text2).lineLimit(1)
            Text(value).font(.system(size: 22, weight: .semibold)).foregroundColor(pal.text).lineLimit(1).minimumScaleFactor(0.7)
            plot.frame(height: 34)
            Text(note.isEmpty ? " " : note).font(.system(size: 10)).foregroundColor(pal.text2).lineLimit(1)
        }.padding(12).frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading).background(RoundedRectangle(cornerRadius: 10).fill(pal.tile))
    }
}
struct ToolIcon: View {
    let c: ToolCall; let tint: Color; let pal: Pal
    var body: some View {
        let on = c.pending == true
        Image(systemName: toolSymbol(c.tool)).font(.system(size: 11, weight: .medium)).foregroundColor(on ? Color.white : pal.text2)
            .frame(width: 22, height: 22).background(RoundedRectangle(cornerRadius: 5).fill(on ? tint : pal.well))
            .help("\(toolName(c.tool))" + ((c.target ?? "").isEmpty ? "" : ": \(c.target ?? "")") + (on ? " (실행 중)" : ""))
    }
}
struct IconStat: View {
    let symbol: String; let value: String; let tip: String; let pal: Pal
    var label = ""   // a word in place of the icon, for figures no icon says (tokens, processes)
    var body: some View {
        HStack(spacing: 4) {
            if label.isEmpty { Image(systemName: symbol).font(.system(size: 10.5)).foregroundColor(pal.text2) } else { Text(label).font(.system(size: 11)).foregroundColor(pal.text2) }
            Text(value).font(.system(size: 11.5, weight: .medium)).monospacedDigit().foregroundColor(pal.text)
        }.lineLimit(1).fixedSize().help(tip)   // the name beside it gives way, never the number
    }
}
/** A session that another session started, in one line: they come in batches and each is small. */
struct SubTile: View {
    let s: Session; let now: Double; let selected: Bool; let pal: Pal; let phase: Phase
    var body: some View {
        let tint = pal.agent(s.agent), mark = stateMark(s), edge = pal.state(phase)
        HStack(spacing: 7) {
            Image(systemName: "arrow.turn.down.right").font(.system(size: 10, weight: .semibold)).foregroundColor(pal.text2)
            if phase == .active { LiveDot(color: edge) } else { Image(systemName: mark.symbol).font(.system(size: 10.5)).foregroundColor(phase == .idle ? pal.text2 : edge).frame(width: 12) }
            Text(s.label).font(.system(size: 12, weight: .medium)).foregroundColor(pal.text).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 4)
            Text("\(mark.label) \(sinceText(s.stateSince, now: now))").font(.system(size: 10.5)).foregroundColor(pal.text2).lineLimit(1).fixedSize()
            if let c = s.context { Text(c.pct.map { "\(Int($0))%" } ?? tokText(c.tokens)).font(.system(size: 11, weight: .medium)).monospacedDigit().foregroundColor(pal.text).fixedSize().help("컨텍스트") }
            if let c = s.usage?.costUsd { Text(String(format: "$%.2f", c)).font(.system(size: 11, weight: .medium)).monospacedDigit().foregroundColor(pal.text).fixedSize() }
            Button(action: { jump(to: s) }) { Image(systemName: "arrow.up.forward.app").font(.system(size: 12)).foregroundColor(pal.text2).frame(width: 22, height: 18).contentShape(Rectangle()) }
                .buttonStyle(HoverStyle(radius: 5)).help("이 세션이 열려 있는 터미널로 이동")
        }.opacity(phase == .idle ? 0.55 : 1).padding(.horizontal, 10).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 9).fill(pal.tile)).overlay(RoundedRectangle(cornerRadius: 9).stroke(selected ? tint : Color.clear, lineWidth: 2)).contentShape(Rectangle())
    }
}
/** One session as marks: its state, how full its context is, its load over time and what it has been calling. The words are behind a click. */
struct SessionTile: View {
    let s: Session; let cpu: Double; let mem: Double; let gpu: Double; let hist: [Hist]; let now: Double; let selected: Bool; let pal: Pal
    var parentName: String? = nil
    var use: Usage? = nil
    var phase: Phase = .active
    var work: [(name: String, w: Work)] = []
    var subs = 0, subsActive = 0    // sessions this one started, and how many of them are working
    func mini<V: View>(_ label: String, _ value: String, compactions: Int? = nil, @ViewBuilder _ plot: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 10)).foregroundColor(pal.text2)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value).font(.system(size: 15, weight: .semibold)).foregroundColor(pal.text).lineLimit(1).minimumScaleFactor(0.7)
                // The same scale as the context meter: muted text, then the palette's warning, then its critical colour.
                if let n = compactions, n >= 1 {
                    Text("압축 \(n)").font(.system(size: 10, weight: .medium)).monospacedDigit().foregroundColor(severity(Double(n), pal.text2, pal, warnAt: 2, critAt: 3).color).lineLimit(1).fixedSize().help(compactionTip(n))
                }
            }
            plot().frame(height: 22)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    var body: some View {
        let tint = pal.agent(s.agent), mark = stateMark(s)
        let calls = Array((s.detail?.recent ?? []).suffix(12))
        let pending = phase == .idle ? nil : calls.last { $0.pending == true }
        let edge = pal.state(phase)
        // A session whose agent sits at its prompt while its programs work is working: say so, not "waiting for input".
        let byLoad = phase == .active && s.state != "busy" && s.state != "shell" && s.subagents == 0
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                Text(s.agent == "codex" ? "Codex" : "Claude").font(.system(size: 9.5, weight: .bold)).foregroundColor(.white).padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(tint)).fixedSize()
                if let up = parentName { Image(systemName: "arrow.turn.down.right").font(.system(size: 10.5, weight: .semibold)).foregroundColor(pal.text2).help("\(up) 세션이 띄운 세션") }
                Text(s.label).font(.system(size: 13.5, weight: .semibold)).foregroundColor(pal.text).lineLimit(1).truncationMode(.middle).help(s.fullName)
                Spacer(minLength: 6)
            }
            HStack(spacing: 5) {
                if phase == .active { LiveDot(color: edge) }
                Image(systemName: byLoad ? "gearshape.2.fill" : mark.symbol).font(.system(size: 11)).foregroundColor(phase == .idle ? pal.text2 : edge)
                Text(byLoad ? "프로그램 실행 중" : mark.label).font(.system(size: 11.5, weight: phase == .idle ? .medium : .semibold)).foregroundColor(pal.text)
                Text(sinceText(s.stateSince, now: now)).font(.system(size: 11)).foregroundColor(pal.text2)
                Spacer(minLength: 4)
                Text([s.modelName ?? "", s.effort ?? ""].filter { !$0.isEmpty }.joined(separator: " ")).font(.system(size: 11)).foregroundColor(pal.text2).lineLimit(1)
            }
            HStack(alignment: .top, spacing: 12) {
                if let c = s.context, let p = c.pct {
                    let sv = severity(p, tint, pal, warnAt: 80, critAt: 95)
                    mini("컨텍스트", "\(Int(p))%", compactions: s.compactions) {
                        HStack(spacing: 5) { Meter(value: p / 100, fill: sv.color); if let sym = sv.symbol { Image(systemName: sym).font(.system(size: 10)).foregroundColor(sv.color) } }.frame(maxHeight: .infinity, alignment: .center)
                    }
                } else { mini("컨텍스트", s.context.map { tokText($0.tokens) } ?? "-", compactions: s.compactions) { Color.clear } }
                // Each bar is this session's share of the whole machine, the same scale on every tile. The session's own trend is in its detail.
                mini("CPU", s.cpu == nil ? "-" : pct1(cpu)) { Meter(value: cpu / 100, fill: tint).frame(maxHeight: .infinity, alignment: .center).help("막대는 기기 전체 CPU에서 이 세션이 쓰는 몫입니다") }
                mini("메모리", s.rssMb == nil ? "-" : memText(mem)) { Meter(value: mem / RAM_MB, fill: tint).frame(maxHeight: .infinity, alignment: .center).help("막대는 기기 메모리 \(Int((RAM_MB / 1024).rounded())) GB에서 이 세션이 쓰는 몫입니다") }
                mini("GPU", pct1(gpu * 100)) { Meter(value: gpu, fill: tint).frame(maxHeight: .infinity, alignment: .center).help("막대는 GPU 시간에서 이 세션이 쓰는 몫입니다") }
            }
            // What is running now: the tool call in flight and the heaviest programs. A resting session shows its last calls instead.
            VStack(alignment: .leading, spacing: 4) {
                if let p = pending {
                    HStack(spacing: 6) {
                        ToolIcon(c: p, tint: tint, pal: pal)
                        Text((p.target ?? "").isEmpty ? toolName(p.tool) : (p.target ?? "")).font(.system(size: 11.5)).foregroundColor(pal.text).lineLimit(1).truncationMode(.tail)
                        Spacer(minLength: 0)
                    }
                }
                if subs > 0 && pending == nil {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.turn.down.right").font(.system(size: 10, weight: .bold)).foregroundColor(.white).frame(width: 22, height: 22).background(RoundedRectangle(cornerRadius: 5).fill(subsActive > 0 ? tint : pal.well))
                        Text("띄운 세션 \(subs)개").font(.system(size: 11.5, weight: .medium)).foregroundColor(pal.text)
                        Spacer(minLength: 4)
                        Text("작업 중 \(subsActive)").font(.system(size: 11.5, weight: .medium)).monospacedDigit().foregroundColor(pal.text)
                    }
                }
                ForEach(Array(work.prefix(pending == nil && subs == 0 ? 2 : 1).enumerated()), id: \.offset) { _, it in
                    HStack(spacing: 6) {
                        Image(systemName: "gearshape.2.fill").font(.system(size: 10)).foregroundColor(.white).frame(width: 22, height: 22).background(RoundedRectangle(cornerRadius: 5).fill(tint))
                        Text(it.name).font(.system(size: 11.5, weight: .medium)).foregroundColor(pal.text).lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        if it.w.gpu >= 0.01 { IconStat(symbol: "display", value: pct1(it.w.gpu * 100), tip: "이 프로그램의 GPU", pal: pal) }
                        if it.w.cpu >= 0.004 { IconStat(symbol: "cpu", value: pct1(it.w.cpu * 100), tip: "이 프로그램의 CPU, 기기 전체 대비", pal: pal) }
                        if it.w.mem >= 512 { IconStat(symbol: "memorychip", value: memText(it.w.mem), tip: "이 프로그램의 메모리", pal: pal) }
                    }
                }
                if pending == nil && work.isEmpty && subs == 0 && phase == .active && s.state == "busy" {
                    HStack(spacing: 6) {
                        Image(systemName: "ellipsis.bubble.fill").font(.system(size: 10)).foregroundColor(.white).frame(width: 22, height: 22).background(RoundedRectangle(cornerRadius: 5).fill(tint))
                        Text("응답을 쓰는 중").font(.system(size: 11.5)).foregroundColor(pal.text)
                        Spacer(minLength: 0)
                    }
                } else if pending == nil && work.isEmpty && subs == 0 {
                    HStack(spacing: 4) {
                        if calls.isEmpty { Text(s.detail == nil ? " " : "최근 도구 호출 없음").font(.system(size: 10.5)).foregroundColor(pal.text2).frame(height: 22) }
                        ForEach(Array(calls.enumerated()), id: \.offset) { _, c in ToolIcon(c: c, tint: tint, pal: pal) }
                        Spacer(minLength: 0)
                    }
                }
            }.frame(height: 48, alignment: .top)
            HStack(spacing: 12) {
                if let c = s.usage?.costUsd { Text(String(format: "$%.2f", c)).font(.system(size: 13, weight: .semibold)).monospacedDigit().foregroundColor(pal.text).fixedSize().help("이 세션의 비용, 정가 환산") }
                if let u = use, u.tree.n > 0 {
                    IconStat(symbol: "gearshape.2", value: u.detached.n > 0 ? "\(u.tree.n), 분리 \(u.detached.n)" : "\(u.tree.n)", tip: u.detached.n > 0 ? "세션 아래 프로세스 \(u.tree.n)개, 세션에서 떼어 띄운 프로세스 \(u.detached.n)개" : "세션 아래 프로세스 수", pal: pal, label: "프로세스")
                } else if let n = s.procs { IconStat(symbol: "gearshape.2", value: "\(n)", tip: "세션 아래 프로세스 수", pal: pal, label: "프로세스") }
                Spacer(minLength: 0)
                Button(action: { jump(to: s) }) {
                    HStack(spacing: 3) { Image(systemName: "arrow.up.forward.app"); Text("세션으로 이동") }.font(.system(size: 11, weight: .medium)).foregroundColor(pal.text2).lineLimit(1).fixedSize().padding(.horizontal, 6).frame(height: 20).contentShape(Rectangle())
                }.buttonStyle(HoverStyle(radius: 5)).help("이 세션이 열려 있는 터미널로 이동")
            }
        }.opacity(phase == .idle ? 0.55 : 1).padding(12).padding(.leading, 5).frame(maxWidth: .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 12).fill(pal.tile))
            .overlay(alignment: .leading) { if phase != .idle { Capsule().fill(edge).frame(width: 4).padding(.vertical, 12).padding(.leading, 5) } }
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? tint : Color.clear, lineWidth: 2))
            .contentShape(Rectangle())
    }
}
/** The dashboard's three layouts. The window's width alone picks one, so dragging the edge and pressing a preset agree. */
enum DashSize: String, CaseIterable { case mini, medium, large
    static func of(_ width: CGFloat) -> DashSize { width < 620 ? .mini : width < 1100 ? .medium : .large }
    var label: String { self == .mini ? "작게" : self == .medium ? "중간" : "크게" }
    var tip: String { self == .mini ? "세션 목록만 봅니다 (⌘1)" : self == .medium ? "세션 타일을 봅니다 (⌘2)" : "세션 타일과 지금 도는 것, 추이를 봅니다 (⌘3)" }
}
/**
 * The height of the dashboard's transparent title bar. The window's view ignores the safe area SwiftUI keeps for that bar
 * and every layout leaves this much itself, so a colour can run up behind the bar while the first row starts right under
 * it. Keeping the safe area as well doubled the gap, which the narrow window cannot afford. The right column and the
 * picked session's overlay start 10 points lower, level with the band: a scroll view that begins right at the bar is
 * composited by the system in a way the self-test's capture cannot read, and the whole column came out blank there.
 */
let TITLE_BAR: CGFloat = 28
/** What the title bar controls show: the layout the window is in, and whether it floats over other windows. */
final class DashUI: ObservableObject { @Published var size: DashSize = .large; @Published var pinned = false }
/** The three size buttons and the pin, in the title bar next to the traffic lights. Drawn like `Segments`, small enough for the standard title bar. */
struct DashControls: View {
    @ObservedObject var ui: DashUI
    let pick: (DashSize) -> Void; let pin: () -> Void
    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 1) {
                ForEach(DashSize.allCases, id: \.self) { s in
                    let on = ui.size == s
                    Button(action: { if !on { pick(s) } }) {
                        Text(s.label).font(.system(size: 11, weight: on ? .semibold : .regular)).lineLimit(1).fixedSize().padding(.horizontal, 7).frame(height: 18)
                            .background(RoundedRectangle(cornerRadius: 4).fill(on ? Color.primary.opacity(0.24) : Color.clear)).contentShape(Rectangle())
                    }.buttonStyle(HoverStyle(radius: 4, off: on)).help(s.tip)
                }
            }.padding(2).background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.09)))
            Button(action: pin) {
                Image(systemName: ui.pinned ? "pin.fill" : "pin").font(.system(size: 11)).foregroundColor(ui.pinned ? Color.accentColor : Color.secondary).frame(width: 22, height: 22).contentShape(Rectangle())
            }.buttonStyle(HoverStyle(radius: 5)).help(ui.pinned ? "다른 창 위에 고정했습니다. 누르면 풉니다" : "다른 창 위에 고정합니다")
        }.padding(.horizontal, 8).frame(height: 24)
    }
}
/** Every session on one screen, in a window of its own, in three sizes: wide shows tiles, what is running and the trends, middle the tiles, narrow only the session list. */
struct DashboardView: View {
    @ObservedObject var model: Model
    var still = false
    var stillWidth: CGFloat = 1480
    var lit: Int? = nil     // draw this session's tile as if the pointer were on it, for a capture
    var forcedDetail: Bool? = nil   // a capture says whether the machine detail is open; the window remembers it
    @AppStorage("dashMachineDetail") private var detail = false
    @State private var selected: Int?
    @State private var hoverPid: Int?            // the session whose row in a largest-users list is under the pointer
    @State private var busyLeft: Set<String> = [] // leftover lines with an open connection: left unticked, something may be using them
    @State private var cleaning = false          // the leftover plate is showing its clean-up choices
    @State private var picked: Set<String> = []
    @State private var cleanNote = ""
    @Environment(\.colorScheme) private var scheme
    private var showDetail: Bool { still ? (forcedDetail ?? false) : detail }
    init(model: Model, still: Bool = false, preselect: Int? = nil, width: CGFloat = 1480, lit: Int? = nil, cleaning: Bool = false, detail: Bool? = nil) { self.model = model; self.still = still; self.stillWidth = width; self.lit = lit; self.forcedDetail = detail; if cleaning { let ids = model.leftoverItems.map { $0.id }.filter { !model.leftoverShared.contains($0) }; let busy = model.leftoverBusy(ids); _cleaning = State(initialValue: true); _busyLeft = State(initialValue: busy); _picked = State(initialValue: Set(ids.filter { !busy.contains($0) })) }; _selected = State(initialValue: preselect) }
    func key(_ c: Color, _ t: String, _ pal: Pal) -> some View { HStack(spacing: 3) { Circle().fill(c).frame(width: 6, height: 6); Text(t).font(.system(size: 10)).foregroundColor(pal.text2).lineLimit(1) } }
    func chip(_ symbol: String, _ color: Color, _ text: String, _ pal: Pal) -> some View {
        HStack(spacing: 4) { Image(systemName: symbol).font(.system(size: 10)).foregroundColor(color).frame(width: 13); Text(text).font(.system(size: 11, weight: .medium)).foregroundColor(pal.text) }.lineLimit(1).fixedSize()
    }
    /** Who uses the machine's CPU: the whole figure, and its parts by owner. The band and the detail tiles both read this. */
    func cpuSplit(_ snap: Snapshot, _ pal: Pal) -> (total: Double, parts: [Part]) {
        let cl = snap.sessions.filter { $0.agent != "codex" }, cx = snap.sessions.filter { $0.agent == "codex" }
        let cpuCl = cl.reduce(0) { $0 + model.cpuOf($1) }, cpuCx = cx.reduce(0) { $0 + model.cpuOf($1) }, cpuLeft = model.leftover.cpu * 100
        let all = max((model.sysCpu ?? 0) * 100, cpuCl + cpuCx + cpuLeft)
        var parts = [Part(id: "Claude 세션", value: cpuCl, color: pal.claude)]
        if !cx.isEmpty { parts.append(Part(id: "Codex 세션", value: cpuCx, color: pal.codex)) }
        parts.append(Part(id: "끝난 세션이 남긴 것", value: cpuLeft, color: pal.left))
        parts.append(Part(id: "그 밖", value: max(0, all - cpuCl - cpuCx - cpuLeft), color: pal.neutral))
        return (all, parts)
    }
    /** The same for memory, in MB. */
    func memSplit(_ snap: Snapshot, _ pal: Pal) -> (total: Double, parts: [Part]) {
        let cl = snap.sessions.filter { $0.agent != "codex" }, cx = snap.sessions.filter { $0.agent == "codex" }
        let memCl = cl.reduce(0) { $0 + model.memOf($1) }, memCx = cx.reduce(0) { $0 + model.memOf($1) }, memLeft = model.leftover.mem
        var parts = [Part(id: "Claude 세션", value: memCl, color: pal.claude)]
        if !cx.isEmpty { parts.append(Part(id: "Codex 세션", value: memCx, color: pal.codex)) }
        parts.append(Part(id: "끝난 세션이 남긴 것", value: memLeft, color: pal.left))
        parts.append(Part(id: "다른 프로그램", value: model.others.reduce(0) { $0 + $1.mem }, color: pal.neutral))
        return (model.sysMemMb ?? 0, parts)
    }
    /** The GPU split the same way as CPU and memory: who is on it, and what is left over. */
    func gpuSplit(_ snap: Snapshot, _ pal: Pal) -> (total: Double, parts: [Part]) {
        let g = (model.gpu ?? 0) * 100
        let hasCodex = snap.sessions.contains { $0.agent == "codex" }
        let cl = min(100, snap.sessions.filter { $0.agent != "codex" }.reduce(0) { $0 + (model.gpuBySession[$1.pid] ?? 0) } * 100)
        let cx = min(100, snap.sessions.filter { $0.agent == "codex" }.reduce(0) { $0 + (model.gpuBySession[$1.pid] ?? 0) } * 100)
        let left = min(100, model.gpuUse.filter { $0.left }.reduce(0) { $0 + $1.share } * 100)
        var parts = [Part(id: "Claude 세션", value: cl, color: pal.claude)]
        if hasCodex { parts.append(Part(id: "Codex 세션", value: cx, color: pal.codex)) }
        parts.append(Part(id: "끝난 세션이 남긴 것", value: left, color: pal.left))
        parts.append(Part(id: "그 밖", value: max(0, g - cl - cx - left), color: pal.neutral))
        return (g, parts)
    }
    /** The thin bar split by owner, the rest in the well colour: the detail tiles draw it 8 points high, the band 6. */
    func splitBar(_ parts: [Part], scale: Double, height: CGFloat, _ pal: Pal) -> some View {
        let full = max(scale, parts.reduce(0) { $0 + $1.value }, 0.000001)
        return GeometryReader { g in
            HStack(spacing: 2) {
                ForEach(parts) { p in if p.value > 0 { Rectangle().fill(p.color).frame(width: max(3, (g.size.width - 2 * CGFloat(parts.count)) * CGFloat(p.value / full))) } }
                Rectangle().fill(pal.well).frame(maxWidth: .infinity)
            }.clipShape(Capsule())
        }.frame(height: height)
    }
    /** The GPU detail tile, shown under the band when the detail is open. */
    func gpuCard(_ snap: Snapshot, _ pal: Pal) -> some View {
        let sp = gpuSplit(snap, pal)
        let top: [Top] = model.gpuLines(snap.sessions, max: 5).map { l in
            let s = l.pid.flatMap { p in snap.sessions.first { $0.pid == p } }
            return Top(id: l.id, name: l.label, value: l.share * 100,
                       color: l.agent == nil ? pal.neutral : l.agent == "left" ? pal.left : pal.agent(l.agent ?? "claude"),
                       pid: s?.pid, program: s == nil || l.note.isEmpty ? nil : l.note, doing: s.flatMap { doingNow($0) },
                       origin: s != nil ? nil : l.agent == "left" ? "끝난 세션이 남긴 것" : "세션과 무관한 프로그램", originSymbol: l.agent == "left" ? "moon.zzz.fill" : "macwindow")
        }
        return machineTile(title: "GPU", total: pct1(sp.total), sub: "기기 전체", parts: sp.parts, scale: 100, fmt: { pct1($0) }, top: top, series: [],
                           tip: "전체 값은 GPU 장치의 사용률이고 이름별 값은 각 프로그램이 GPU를 쓴 시간의 비율입니다. 재는 방식이 달라 합이 조금 어긋날 수 있습니다", pal: pal)
    }
    struct Counts { var active = 0, mains = 0, user = 0, idle = 0, subs = 0 }
    /** How many main sessions work, wait for the user or rest, and how many sessions they started. Every place that says it reads this one count. */
    func counts(_ snap: Snapshot) -> Counts {
        let mainOnes = snap.sessions.filter { model.parentSession[$0.pid] == nil }
        let phases = mainOnes.map { model.phase($0) }
        return Counts(active: phases.filter { $0 == .active }.count, mains: mainOnes.count, user: phases.filter { $0 == .needsUser }.count, idle: phases.filter { $0 == .idle }.count, subs: snap.sessions.count - mainOnes.count)
    }
    /** One tile of the band: 58 pt high on the same plate as every tile. `grow` lets it take the width the others leave. */
    func bandTile<V: View>(_ pal: Pal, width: CGFloat? = nil, grow: Bool = false, @ViewBuilder _ content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 3) { content() }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .frame(width: width, height: 58, alignment: .leading)
            .frame(maxWidth: grow ? CGFloat.infinity : nil, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(pal.tile))
    }
    func bandLabel(_ text: String, _ pal: Pal) -> some View { Text(text).font(.system(size: 10.5)).foregroundColor(pal.text2).fixedSize() }
    func sessionsTile(_ snap: Snapshot, _ pal: Pal) -> some View {
        let n = counts(snap)
        return bandTile(pal, grow: true) {
            bandLabel("작업 중인 세션", pal)
            HStack(spacing: 7) {
                if n.active > 0 { LiveDot(color: pal.good) }
                Text("\(n.active)").font(.system(size: 18, weight: .semibold)).monospacedDigit().foregroundColor(pal.text).fixedSize()
                Text("/ \(n.mains)").font(.system(size: 12)).foregroundColor(pal.text2).fixedSize()
                if n.user > 0 { chip("hand.raised.fill", pal.warning, "확인 대기 \(n.user)", pal) }
                if n.idle > 0 { chip("pause.circle", pal.text2, "입력 대기 \(n.idle)", pal) }
                if n.subs > 0 { chip("arrow.turn.down.right", pal.text2, "띄운 세션 \(n.subs)", pal) }
            }
        }
    }
    /** CPU, memory or GPU as a figure and the split bar; the line each part says is in the tooltip. */
    func resourceTile(_ title: String, _ value: String, _ parts: [Part], scale: Double, fmt: (Double) -> String, fixed: Bool, _ pal: Pal) -> some View {
        let tip = (["누르면 나눠 쓰는 몫과 많이 쓰는 곳을 펼칩니다"] + parts.map { "\($0.id) \(fmt($0.value))" }).joined(separator: "\n")
        return bandTile(pal, width: fixed ? 118 : nil, grow: !fixed) {
            HStack(spacing: 4) {
                Text(title).font(.system(size: 10.5)).foregroundColor(pal.text2).fixedSize()
                Spacer(minLength: 4)
                Text(value).font(.system(size: 13, weight: .semibold)).monospacedDigit().foregroundColor(pal.text).fixedSize()
            }
            splitBar(parts, scale: scale, height: 6, pal).padding(.top, 3)
        }.help(tip)
    }
    /** The three machine tiles are one button: pressing any of them opens or closes the detail above the sessions. */
    func resources(_ snap: Snapshot, _ pal: Pal, fixed: Bool) -> some View {
        let cpu = cpuSplit(snap, pal), mem = memSplit(snap, pal), gpu = gpuSplit(snap, pal)
        return Pressable(radius: 10, action: { detail.toggle() }) {
            HStack(spacing: 6) {
                resourceTile("CPU", pct1(cpu.total), cpu.parts, scale: 100, fmt: { pct1($0) }, fixed: fixed, pal)
                resourceTile("메모리", memText(mem.total), mem.parts, scale: RAM_MB, fmt: { memText($0) }, fixed: fixed, pal)
                if model.gpu != nil { resourceTile("GPU", pct1(gpu.total), gpu.parts, scale: 100, fmt: { pct1($0) }, fixed: fixed, pal) }
                Image(systemName: showDetail ? "chevron.up" : "chevron.down").font(.system(size: 9)).foregroundColor(pal.text2).frame(width: 12)
            }
        }
    }
    func limitsTile(_ snap: Snapshot, _ pal: Pal) -> some View {
        let wins = snap.usage?.claude?.windows ?? []
        return bandTile(pal) {
            bandLabel("Claude 한도", pal)
            HStack(alignment: .top, spacing: 12) {
                ForEach(wins, id: \.key) { w in
                    let sv = severity(w.usedPct, pal.claude, pal)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 4) {
                            Text(windowName(w)).font(.system(size: 11.5, weight: .medium)).foregroundColor(pal.text).fixedSize()
                            if let sym = sv.symbol { Image(systemName: sym).font(.system(size: 10)).foregroundColor(sv.color) }
                            Spacer(minLength: 4)
                            Text("\(Int(w.usedPct.rounded()))%").font(.system(size: 13, weight: .semibold)).monospacedDigit().foregroundColor(pal.text).fixedSize()
                        }
                        Meter(value: w.usedPct / 100, fill: sv.color, height: 5)
                    }.frame(minWidth: 84, alignment: .leading).help(resetText(w.resetsAt, now: snap.at))
                }
            }
        }
    }
    func costTile(_ snap: Snapshot, _ pal: Pal) -> some View {
        let sm = model.samples, span = spanText(sm.first?.at, sm.last?.at)
        let costs = sm.map { $0.cost }, costUp = (costs.last ?? 0) - (costs.first ?? 0)
        var tip = "실행 중인 세션 \(snap.sessions.count)개 합계입니다. 구독 청구액이 아니라 쓴 토큰을 정가로 환산한 값입니다"
        if costUp > 0.005 { tip += "\n" + String(format: "%@ 동안 +$%.2f", span, costUp) }
        return bandTile(pal) {
            bandLabel("세션 비용, 정가 환산", pal)
            Text(snap.totals.costUsd.map { String(format: "$%.2f", $0) } ?? "-").font(.system(size: 15, weight: .semibold)).monospacedDigit().foregroundColor(pal.text).fixedSize()
        }.help(tip)
    }
    func rankTile(_ st: Standing, _ pal: Pal) -> some View {
        var tip = ""
        if let p = st.scorePct { tip = "점수 백분위 \(Int(p))%" + (st.next.map { ", 다음 \($0.emoji) \($0.floorPct.map { "\(Int($0))%" } ?? "")" } ?? "") }
        return bandTile(pal) {
            bandLabel("이달의 랭킹", pal)
            HStack(spacing: 6) {
                Text(st.emoji).font(.system(size: 15)).fixedSize()
                Text(st.name).font(.system(size: 12.5, weight: .semibold)).foregroundColor(pal.text).fixedSize()
                if st.crown == true { Image(systemName: "crown.fill").font(.system(size: 9.5)).foregroundColor(pal.warning) }
                Text(st.rank != nil && st.ranked != nil ? "\(Int(st.ranked!))명 중 \(Int(st.rank!))위" : "집계 전").font(.system(size: 11.5)).foregroundColor(pal.text2).fixedSize()
            }
        }.help(tip)
    }
    /**
     * One thin band instead of the big machine and summary tiles: what the sessions are doing, the machine as three small
     * bars, the account limits, the cost and the ranking. The first row that fits the width wins, and the last one wraps.
     */
    func band(_ snap: Snapshot, _ pal: Pal) -> some View {
        let sessions = sessionsTile(snap, pal), cost = costTile(snap, pal)
        let hasLimits = !(snap.usage?.claude?.windows ?? []).isEmpty
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { sessions; resources(snap, pal, fixed: true); if hasLimits { limitsTile(snap, pal) }; cost; if let st = snap.standing { rankTile(st, pal) } }
            HStack(spacing: 8) { sessions; resources(snap, pal, fixed: true); if hasLimits { limitsTile(snap, pal) }; cost }
            HStack(spacing: 8) { sessions; resources(snap, pal, fixed: true); if hasLimits { limitsTile(snap, pal) } }
            HStack(spacing: 8) { sessions; resources(snap, pal, fixed: true) }
            VStack(spacing: 8) { sessions; resources(snap, pal, fixed: false) }
        }
    }
    /** Trends at a size and with the labels that let them be read: the machine against the sessions, for CPU, memory and GPU. */
    func trends(_ pal: Pal) -> some View {
        let sm = model.samples, span = spanText(sm.first?.at, sm.last?.at)
        let whole: (Double) -> String = { "\(Int($0.rounded()))%" }
        return VStack(alignment: .leading, spacing: 12) {
            Text("추이").font(.system(size: 13, weight: .semibold)).foregroundColor(pal.text)
            TrendChart(title: "CPU", lines: [.init(id: "기기 전체", values: sm.map { $0.sysCpu * 100 }, color: pal.neutral, fill: true), .init(id: "세션", values: sm.map { ($0.claudeCpu + $0.codexCpu) * 100 }, color: pal.claude)], top: 100, fmt: whole, span: span, pal: pal)
            TrendChart(title: "메모리", lines: [.init(id: "기기 전체", values: sm.map { $0.sysMem * RAM_MB }, color: pal.neutral, fill: true), .init(id: "세션", values: sm.map { ($0.claudeMem + $0.codexMem) * RAM_MB }, color: pal.claude)], top: RAM_MB, fmt: { memText($0) }, span: span, pal: pal)
            if model.gpu != nil {
                TrendChart(title: "GPU", lines: [.init(id: "기기 전체", values: sm.map { $0.gpu * 100 }, color: pal.neutral, fill: true), .init(id: "세션", values: sm.map { ($0.claudeGpu + $0.codexGpu) * 100 }, color: pal.claude)], top: 100, fmt: whole, span: span, pal: pal)
            }
        }
    }
    /** One session's own trends, each on a scale that fits it and says so. */
    func sessionTrends(_ s: Session, _ pal: Pal) -> some View {
        let h = model.hist[s.pid] ?? [], span = spanText(h.first?.at, h.last?.at), tint = pal.agent(s.agent)
        let cpuTop = max(5, ((h.map { $0.cpu }.max() ?? 0) / 5).rounded(.up) * 5), memTop = max(1024, ((h.map { $0.mem }.max() ?? 0) / 1024).rounded(.up) * 1024)
        let gpuTop = max(10, ((h.map { $0.gpu * 100 }.max() ?? 0) / 10).rounded(.up) * 10)
        return VStack(alignment: .leading, spacing: 12) {
            TrendChart(title: "CPU", lines: [.init(id: "이 세션", values: h.map { $0.cpu }, color: tint, fill: true)], top: cpuTop, fmt: { pct1($0) }, span: span, pal: pal)
            TrendChart(title: "메모리", lines: [.init(id: "이 세션", values: h.map { $0.mem }, color: tint, fill: true)], top: memTop, fmt: { memText($0) }, span: span, pal: pal)
            TrendChart(title: "GPU", lines: [.init(id: "이 세션", values: h.map { $0.gpu * 100 }, color: tint, fill: true)], top: gpuTop, fmt: { pct1($0) }, span: span, pal: pal)
        }
    }
    func inspector(_ s: Session, _ snap: Snapshot, _ pal: Pal) -> some View {
        let body = VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Text(s.label).font(.system(size: 15, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 6)
                Button(action: { jump(to: s) }) { HStack(spacing: 4) { Image(systemName: "arrow.up.forward.app"); Text("세션으로 이동") }.font(.system(size: 11.5, weight: .medium)).padding(.horizontal, 8).padding(.vertical, 4).background(RoundedRectangle(cornerRadius: 6).fill(pal.well)).contentShape(Rectangle()) }
                    .buttonStyle(HoverStyle(radius: 6)).help("이 세션이 열려 있는 터미널 앱을 앞으로 가져옵니다")
                Button(action: { selected = nil }) { Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundColor(pal.text2).contentShape(Rectangle()) }.buttonStyle(HoverStyle(radius: 10, grow: 4)).help("닫기")
            }
            if let c = s.cwd { Text(c).font(.system(size: 10.5, design: .monospaced)).foregroundColor(pal.text2).lineLimit(1).truncationMode(.head) }
            Text(activity(s, now: snap.at)).font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
            Divider().padding(.vertical, 2)
            if let c = s.context { Fact(label: "컨텍스트", value: contextLine(c)) }
            if let n = s.compactions, n >= 1 { Fact(label: "압축", value: "\(n)번") }
            if let u = s.usage {
                Fact(label: "토큰", value: tokenLine(u))
                Fact(label: "비용", value: [u.costUsd.map { String(format: "$%.2f (정가 환산)", $0) } ?? "가격표 없음", u.requests.map { "요청 \(Int($0))회" } ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
            }
            if let u = model.usage[s.pid], u.detached.n > 0 {
                Fact(label: "분리 실행", value: u.names.sorted { $0.value.mem > $1.value.mem }.prefix(4).map { "\($0.key) \(memText($0.value.mem))" }.joined(separator: ", "))
            }
            let onGpu = model.gpuUse.filter { $0.session == s.pid }
            if !onGpu.isEmpty { Fact(label: "GPU", value: "\(pct1(min(1, onGpu.reduce(0) { $0 + $1.share }) * 100)) (\(onGpu.prefix(3).map { "\($0.name) \(pct1($0.share * 100))" }.joined(separator: ", ")))") }
            Divider().padding(.vertical, 2)
            WorkSummary(d: s.detail, now: snap.at, textLines: 12, calls: 12, procs: 5, off: model.detailOff)
            Divider().padding(.vertical, 2)
            sessionTrends(s, pal)
        }.padding(14).frame(width: 372, alignment: .topLeading).foregroundColor(pal.text)
        return Group { if still { body } else { ScrollView { body } } }.frame(width: 372).frame(maxHeight: still ? nil : .infinity, alignment: .top).background(pal.tile)
    }
    struct Part: Identifiable { let id: String; let value: Double; let color: Color }
    struct Top: Identifiable {
        let id: String; let name: String; let value: Double; let color: Color
        var pid: Int? = nil           // a live session: the row picks it
        var program: String? = nil    // what in that session is using it, with its own share
        var doing: String? = nil      // what that session is doing now
        var origin: String? = nil     // outside any live session: where it comes from
        var originSymbol = "moon.zzz.fill"
    }
    /** What a session is doing now, in one line: the tool call in flight, else the request it is on, else that it is waiting. */
    func doingNow(_ s: Session) -> String? {
        if s.state == "waiting" { return "확인을 기다리는 중" }
        let ask = s.detail?.prompt?.text.split(whereSeparator: \.isNewline).first.map { String($0).trimmingCharacters(in: .whitespaces) }
        if model.phase(s) == .idle { return ask.map { "입력 대기 중, 마지막 요청: \($0)" } ?? "입력 대기 중" }
        if let p = s.detail?.recent?.last(where: { $0.pending == true }) { return p.target.map { "\(p.tool): \($0)" } ?? p.tool }
        if let a = ask { return "요청: \(a)" }
        return s.tools.first
    }
    /** The one program behind most of a session's figure, with its own share: the answer to "what in that session is using it". */
    func heaviest(_ s: Session, total: Double, _ part: (Work) -> Double, _ fmt: (Double) -> String) -> String? {
        guard let u = model.usage[s.pid] else { return nil }
        let named = u.work.filter { !$0.key.isEmpty }.map { (name: $0.key, v: part($0.value)) }
        let own = max(0, total - named.reduce(0) { $0 + $1.v })
        let all = named + [(name: s.agent == "codex" ? "Codex 자체" : "Claude Code 자체", v: own)]
        guard let top = all.max(by: { $0.v < $1.v }), top.v > 0 else { return nil }
        return "\(top.name) \(fmt(top.v))"
    }
    func leftOrigin(_ id: String) -> String { model.leftoverWhere[id].map { "끝난 세션이 남긴 것, 폴더 \($0)" } ?? "끝난 세션이 남긴 것" }
    /** A line under a largest-user row: an icon and the reason, small and in secondary ink. */
    func why(_ symbol: String, _ text: String, _ pal: Pal) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: symbol).font(.system(size: 8.5)).foregroundColor(pal.text2).frame(width: 12)
            Text(text).font(.system(size: 10.5)).foregroundColor(pal.text2).lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
        }.padding(.leading, 12)
    }
    /** One machine resource: the total, a thin bar split by who is using it with its legend, a trend, and the largest users by name. */
    func machineTile(title: String, total: String, sub: String, parts: [Part], scale: Double, fmt: @escaping (Double) -> String, top: [Top], series: [(v: [Double], c: Color)], tip: String, pal: Pal) -> some View {
        let topMax = max(top.map { $0.value }.max() ?? 0, 0.000001)
        // The figure, bar and legend take a fixed narrow column, so every remaining point of width goes to the names of the largest users.
        return HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11)).foregroundColor(pal.text2)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(total).font(.system(size: 26, weight: .semibold)).foregroundColor(pal.text).lineLimit(1).fixedSize()
                    Text(sub).font(.system(size: 11)).foregroundColor(pal.text2).lineLimit(1)
                }
                splitBar(parts, scale: scale, height: 8, pal)
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(parts) { p in
                        HStack(spacing: 5) {
                            Circle().fill(p.color).frame(width: 6, height: 6)
                            Text(p.id).font(.system(size: 10.5)).foregroundColor(pal.text2).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(fmt(p.value)).font(.system(size: 10.5, weight: .medium)).monospacedDigit().foregroundColor(pal.text).fixedSize()
                        }
                    }
                }
            }.frame(width: 196, alignment: .topLeading)
            VStack(alignment: .leading, spacing: 3) {
                Text("많이 쓰는 곳").font(.system(size: 10)).foregroundColor(pal.text2).padding(.leading, 6)
                if top.isEmpty { Text("지금 쓰는 곳이 없습니다").font(.system(size: 11)).foregroundColor(pal.text2).padding(.leading, 6) }
                ForEach(top) { t in
                    // The bar is the row's own background, so it costs the name no width. Under the name come what in that
                    // session is using it and what the session is doing: a figure next to a bare name answers nothing.
                    let row = VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Circle().fill(t.color).frame(width: 6, height: 6)
                            Text(t.name).font(.system(size: 11.5, weight: t.pid == nil ? .regular : .medium)).foregroundColor(pal.text).lineLimit(3).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 4)
                            Text(fmt(t.value)).font(.system(size: 11.5, weight: .medium)).monospacedDigit().foregroundColor(pal.text).fixedSize()
                        }
                        if let p = t.program { why("gearshape.2.fill", p, pal) }
                        if let d = t.doing { why("text.bubble.fill", d, pal) }
                        if let o = t.origin { why(t.originSymbol, o, pal) }
                    }.padding(.horizontal, 6).padding(.vertical, 3)
                        .background(alignment: .topLeading) { GeometryReader { g in RoundedRectangle(cornerRadius: 4).fill(t.color.opacity(0.22)).frame(width: max(4, g.size.width * CGFloat(t.value / topMax)), height: 20) } }
                    if let pid = t.pid {
                        Pressable(radius: 5, lit: selected == pid, action: { selected = selected == pid ? nil : pid }) { row }
                            .onHover { inside in hoverPid = inside ? pid : (hoverPid == pid ? nil : hoverPid) }
                            .help(([t.name, t.program, t.doing].compactMap { $0 } + ["눌러서 이 세션의 상세를 봅니다"]).joined(separator: "\n"))
                    } else { row.help([t.name, t.origin].compactMap { $0 }.joined(separator: "\n")) }
                }
            }.frame(maxWidth: .infinity, alignment: .topLeading)
        }.padding(12).frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading).background(RoundedRectangle(cornerRadius: 10).fill(pal.tile)).help(tip)
    }
    func machine(_ snap: Snapshot, _ pal: Pal, width: CGFloat) -> some View {
        let sm = model.samples, ses = snap.sessions
        let cpu = cpuSplit(snap, pal), mem = memSplit(snap, pal)
        func tops(_ pick: (AppLoad) -> Double, _ of: (Session) -> Double, _ part: (Work) -> Double, _ show: (Double) -> String) -> [Top] {
            var t = ses.map { s in Top(id: "s\(s.pid)", name: s.label, value: of(s), color: pal.agent(s.agent), pid: s.pid, program: heaviest(s, total: of(s), part, show), doing: doingNow(s)) }
            t += model.leftoverItems.map { Top(id: "l\($0.id)", name: $0.name, value: pick($0), color: pal.left, origin: leftOrigin($0.id)) }
            t += model.others.map { Top(id: "o\($0.id)", name: $0.name, value: pick($0), color: pal.neutral, origin: "세션과 무관한 프로그램", originSymbol: "macwindow") }
            return Array(t.sorted { $0.value > $1.value }.prefix(5))
        }
        let a = machineTile(title: "CPU", total: pct1(cpu.total), sub: "기기 전체", parts: cpu.parts, scale: 100, fmt: { pct1($0) }, top: tops({ $0.cpu * 100 }, { model.cpuOf($0) }, { $0.cpu * 100 }, { pct1($0) }),
                            series: [(sm.map { $0.sysCpu * 100 }, pal.neutral), (sm.map { ($0.claudeCpu + $0.codexCpu) * 100 }, pal.claude)],
                            tip: "세션 값에는 세션이 따로 떼어 띄운 프로세스도 들어갑니다. 회색 선은 기기 전체, 색 선은 실행 중인 세션입니다", pal: pal)
        let b = machineTile(title: "메모리", total: memText(mem.total), sub: "/ \(Int((RAM_MB / 1024).rounded())) GB 사용", parts: mem.parts, scale: RAM_MB, fmt: { memText($0) }, top: tops({ $0.mem }, { model.memOf($0) }, { $0.mem }, { memText($0) }),
                            series: [(sm.map { $0.sysMem * 100 }, pal.neutral), (sm.map { ($0.claudeMem + $0.codexMem) * 100 }, pal.claude)],
                            tip: "프로그램별 값은 압축된 메모리와 GPU 메모리까지 센 점유량입니다. 그래서 합이 실제 사용량보다 클 수 있습니다", pal: pal)
        return Group { if width >= 900 { HStack(alignment: .top, spacing: 10) { a; b } } else { VStack(spacing: 10) { a; b } } }
    }
    /**
     * What ended sessions left running, by program: nothing here belongs to a session that is still open. "정리" turns
     * the lines into a checklist: everything is ticked except apps, virtual machines and databases, which cannot be
     * ticked at all, and nothing is stopped until the second button is pressed.
     */
    func leftoverPlate(_ pal: Pal) -> some View {
        let items = Array(model.leftoverItems.prefix(12))
        let can = items.filter { !model.leftoverShared.contains($0.id) }
        let chosen = can.filter { picked.contains($0.id) }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                HStack(spacing: 5) {
                    Image(systemName: "moon.zzz.fill").font(.system(size: 11)).foregroundColor(pal.left)
                    Text("끝난 세션이 남긴 프로세스").font(.system(size: 12.5, weight: .semibold)).foregroundColor(pal.text)
                    Text("\(model.leftover.n)").font(.system(size: 10.5, weight: .bold)).foregroundColor(pal.text).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(pal.well))
                }.help("Claude 세션이 띄웠고 그 세션이 끝난 뒤에도 돌고 있는 프로세스입니다")
                if !cleanNote.isEmpty { Text(cleanNote).font(.system(size: 11)).foregroundColor(pal.text2).lineLimit(1) }
                Spacer(minLength: 4)
                IconStat(symbol: "cpu", value: pct1(model.leftover.cpu * 100), tip: "CPU 합계", pal: pal)
                IconStat(symbol: "memorychip", value: memText(model.leftover.mem), tip: "메모리 합계", pal: pal)
                if !cleaning && !can.isEmpty {
                    Button(action: { busyLeft = model.leftoverBusy(can.map { $0.id }); picked = Set(can.map { $0.id }.filter { !busyLeft.contains($0) }); cleanNote = ""; cleaning = true }) {
                        HStack(spacing: 3) { Image(systemName: "trash"); Text("정리") }.font(.system(size: 11, weight: .medium)).foregroundColor(pal.text).lineLimit(1).fixedSize()
                            .padding(.horizontal, 8).frame(height: 20).background(RoundedRectangle(cornerRadius: 5).fill(pal.well)).contentShape(Rectangle())
                    }.buttonStyle(HoverStyle(radius: 5)).help("남은 프로세스를 골라서 끕니다. 고르는 화면이 먼저 나오고 앱과 가상 머신과 데이터베이스는 빠집니다")
                }
            }.padding(.horizontal, 4).frame(height: 22)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
                ForEach(items) { it in
                    let fixed = model.leftoverShared.contains(it.id), on = picked.contains(it.id)
                    let row = HStack(spacing: 8) {
                        if cleaning {
                            Image(systemName: fixed ? "lock.fill" : on ? "checkmark.square.fill" : "square").font(.system(size: 12)).foregroundColor(fixed ? pal.text2 : on ? pal.left : pal.text2).frame(width: 14)
                        } else { Circle().fill(pal.left).frame(width: 6, height: 6) }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(it.name).font(.system(size: 12, weight: .medium)).foregroundColor(pal.text).lineLimit(1).truncationMode(.middle)
                            if let w = model.leftoverWhere[it.id] { Text("폴더 \(w)").font(.system(size: 10.5)).foregroundColor(pal.text2).lineLimit(1).truncationMode(.middle) }
                        }
                        if it.n > 1 { Text("\(it.n)개").font(.system(size: 11)).foregroundColor(pal.text2).fixedSize() }
                        if cleaning && busyLeft.contains(it.id) { Text("연결 중").font(.system(size: 10, weight: .medium)).foregroundColor(pal.text).padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(pal.well)).fixedSize() }
                        Spacer(minLength: 4)
                        IconStat(symbol: "cpu", value: pct1(it.cpu * 100), tip: "CPU, 기기 전체 대비", pal: pal)
                        IconStat(symbol: "memorychip", value: memText(it.mem), tip: "메모리", pal: pal)
                    }.padding(.horizontal, 10).padding(.vertical, 7).background(RoundedRectangle(cornerRadius: 8).fill(pal.tile)).opacity(cleaning && fixed ? 0.6 : 1)
                    if cleaning && !fixed {
                        Pressable(radius: 8, action: { if on { picked.remove(it.id) } else { picked.insert(it.id) } }) { row }.help(it.name)
                    } else if !cleaning, let sid = model.leftoverSession[it.id] {
                        Pressable(radius: 8, action: { resumeSession(sid, fallbackDir: model.leftoverPids[it.id]?.first.flatMap { procCwd($0.pid) }) }) { row }
                            .help("\(it.name): 누르면 이 프로세스를 띄운 세션을 새 터미널에서 다시 엽니다. 무엇을 하던 세션인지 보고 끌지 정하십시오")
                    } else {
                        row.help(cleaning && fixed ? "앱, 가상 머신, 데이터베이스는 다른 작업이 쓰고 있을 수 있어 여기서 끄지 않습니다. 그 프로그램에서 직접 끄십시오" : it.name)
                    }
                }
            }
            if cleaning {
                HStack(alignment: .center, spacing: 10) {
                    Text("고른 \(chosen.count)개를 끄면 CPU \(pct1(chosen.reduce(0) { $0 + $1.cpu } * 100))와 메모리 \(memText(chosen.reduce(0) { $0 + $1.mem }))가 돌아옵니다. 자물쇠가 붙은 것은 앱이나 가상 머신이나 데이터베이스라 뺐습니다. 연결 중이라고 적힌 것은 무언가 쓰고 있을 수 있어 선택하지 않았습니다.")
                        .font(.system(size: 11)).foregroundColor(pal.text2).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    Pill("취소") { cleaning = false }
                    Pill("고른 \(chosen.count)개 종료", .danger, disabled: chosen.isEmpty) {
                        let n = model.stopLeftovers(chosen.map { $0.id })
                        cleanNote = "프로세스 \(n)개에 종료를 요청했습니다"; cleaning = false
                    }
                }.padding(.horizontal, 4).padding(.top, 2)
            }
        }.padding(8).background(RoundedRectangle(cornerRadius: 16).fill(pal.group))
    }
    func groupHead(_ g: SessionGroup, _ pal: Pal) -> some View {
        let many = g.sessions.count > 1
        let cost = g.sessions.compactMap { $0.usage?.costUsd }.reduce(0, +)
        let cpu = g.sessions.reduce(0) { $0 + model.cpuOf($1) }, mem = g.sessions.reduce(0) { $0 + model.memOf($1) }
        let gpu = g.sessions.reduce(0) { $0 + (model.gpuBySession[$1.pid] ?? 0) }
        return HStack(spacing: 12) {
            HStack(spacing: 5) {
                Image(systemName: many ? "folder.fill" : "folder").font(.system(size: 11)).foregroundColor(pal.text2)
                Text(g.name).font(.system(size: 12.5, weight: .semibold)).foregroundColor(pal.text).lineLimit(1).truncationMode(.middle)
                if many { Text("\(g.sessions.count)").font(.system(size: 10.5, weight: .bold)).foregroundColor(pal.text).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(pal.well)).help("이 프로젝트에서 실행 중인 세션 수") }
            }
            Spacer(minLength: 4)
            if many {
                IconStat(symbol: "dollarsign.circle", value: String(format: "%.2f", cost), tip: "이 프로젝트 세션의 비용 합계, 정가 환산", pal: pal)
                IconStat(symbol: "cpu", value: pct1(cpu), tip: "이 프로젝트 세션의 CPU 합계", pal: pal)
                IconStat(symbol: "memorychip", value: memText(mem), tip: "이 프로젝트 세션의 메모리 합계", pal: pal)
                if gpu >= 0.001 { IconStat(symbol: "display", value: pct1(gpu * 100), tip: "이 프로젝트 세션의 GPU 합계", pal: pal) }
            }
        }.padding(.horizontal, 4).frame(height: 20)
    }
    /**
     * Project groups laid out on a grid of equal cells: a group takes one cell per session, up to a whole row, and starts
     * a new row when the cells left on this one are too few. Sessions of one project never end up apart.
     */
    func groupsView(_ snap: Snapshot, _ pal: Pal, width: CGFloat) -> some View {
        let gap: CGFloat = 12, minCell: CGFloat = 318
        let cols = max(1, Int((width + gap) / (minCell + gap)))
        let cell = (width - CGFloat(cols - 1) * gap) / CGFloat(cols)
        let names = Dictionary(snap.sessions.map { ($0.pid, $0.label) }, uniquingKeysWith: { a, _ in a })
        // A group is as wide as its main sessions need, and at least wide enough to lay its started sessions side by side.
        let isSub: (Session, SessionGroup) -> Bool = { s, g in model.parentSession[s.pid].map { up in g.sessions.contains { $0.pid == up } } ?? false }
        let spanOf: (SessionGroup) -> Int = { g in
            let subs = g.sessions.filter { isSub($0, g) }.count
            return min(cols, max(1, g.sessions.count - subs, min(subs, cols)))
        }
        var rows: [[SessionGroup]] = [[]], used = 0
        for g in groupSessions(model.ordered(snap.sessions), parents: model.parentSession) {
            let span = spanOf(g)
            if used + span > cols { rows.append([]); used = 0 }
            rows[rows.count - 1].append(g); used += span
        }
        return VStack(alignment: .leading, spacing: gap) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: gap) {
                    ForEach(row) { g in
                        let span = spanOf(g)
                        let mains = g.sessions.filter { !isSub($0, g) }, subs = g.sessions.filter { isSub($0, g) }
                        let grid = Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: span)
                        VStack(alignment: .leading, spacing: 6) {
                            groupHead(g, pal)
                            LazyVGrid(columns: grid, alignment: .leading, spacing: 8) {
                                ForEach(mains) { s in
                                    Pressable(radius: 12, lit: lit == s.pid || hoverPid == s.pid, action: { selected = selected == s.pid ? nil : s.pid }) {
                                        SessionTile(s: s, cpu: model.cpuOf(s), mem: model.memOf(s), gpu: model.gpuBySession[s.pid] ?? 0, hist: model.hist[s.pid] ?? [], now: snap.at, selected: selected == s.pid, pal: pal,
                                                    parentName: nil, use: model.usage[s.pid], phase: model.phase(s), work: model.working(s),
                                                    subs: subs.filter { model.parentSession[$0.pid] == s.pid }.count, subsActive: subs.filter { model.parentSession[$0.pid] == s.pid && model.phase($0) == .active }.count)
                                    }
                                }
                            }
                            if !subs.isEmpty {
                                HStack(spacing: 5) {
                                    Image(systemName: "arrow.turn.down.right").font(.system(size: 10, weight: .semibold))
                                    Text("이 프로젝트의 세션이 띄운 세션 \(subs.count)개").font(.system(size: 11))
                                }.foregroundColor(pal.text2).padding(.horizontal, 4).padding(.top, 2)
                                LazyVGrid(columns: grid, alignment: .leading, spacing: 6) {
                                    ForEach(subs) { s in
                                        Pressable(radius: 9, lit: lit == s.pid, action: { selected = selected == s.pid ? nil : s.pid }) {
                                            SubTile(s: s, now: snap.at, selected: selected == s.pid, pal: pal, phase: model.phase(s))
                                        }.help(model.parentSession[s.pid].flatMap { names[$0] }.map { "\($0) 세션이 띄운 세션" } ?? "")
                                    }
                                }
                            }
                        }.padding(8).frame(width: CGFloat(span) * cell + CGFloat(span - 1) * gap, alignment: .topLeading)
                            .background(RoundedRectangle(cornerRadius: 16).fill(pal.group))
                    }
                }
            }
            if model.leftover.n > 0 { leftoverPlate(pal) }
        }
    }
    func stats(_ w: Work, _ pal: Pal) -> some View {
        HStack(spacing: 10) {
            if w.gpu >= 0.01 { IconStat(symbol: "display", value: pct1(w.gpu * 100), tip: "GPU", pal: pal) }
            if w.cpu >= 0.004 { IconStat(symbol: "cpu", value: pct1(w.cpu * 100), tip: "CPU, 기기 전체 대비", pal: pal) }
            if w.mem >= 512 { IconStat(symbol: "memorychip", value: memText(w.mem), tip: "메모리", pal: pal) }
        }
    }
    func warnText(_ w: Warn) -> String { w.chip.replacingOccurrences(of: "⚠ ", with: "").replacingOccurrences(of: "🚨 ", with: "") }
    func warnIcon(_ w: Warn, _ pal: Pal) -> some View {
        Image(systemName: w.level == "critical" ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundColor(w.level == "critical" ? pal.critical : pal.warning)
    }
    /** The statusline's warnings as capsules in one row, under the band. */
    func warnChips(_ ws: [Warn], _ pal: Pal) -> some View {
        HStack(spacing: 8) {
            ForEach(ws) { w in
                HStack(spacing: 6) { warnIcon(w, pal); Text(warnText(w)).font(.system(size: 12, weight: .medium)).foregroundColor(pal.text) }
                    .padding(.horizontal, 9).padding(.vertical, 5).background(Capsule().fill(pal.tile)).help(w.advice?.first?.tip ?? w.advice?.first?.title ?? "")
            }
            Spacer(minLength: 0)
        }
    }
    /** One session that is working or waiting for the user. `dense` says in one line what it is doing, where the wide layout lists its programs. */
    func liveRow(_ s: Session, _ snap: Snapshot, _ pal: Pal, subs: [Session], dense: Bool, pick: @escaping (Session) -> Void) -> some View {
        let ph = model.phase(s), tint = pal.state(ph), mark = stateMark(s)
        let byLoad = ph == .active && s.state != "busy" && s.state != "shell" && s.subagents == 0
        let pending = (s.detail?.recent ?? []).last { $0.pending == true }
        let name = Text(s.label).font(.system(size: 12.5, weight: .semibold)).foregroundColor(pal.text)
        let row = VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: dense ? .top : .center, spacing: 6) {
                if ph == .active { LiveDot(color: tint) } else { Image(systemName: mark.symbol).font(.system(size: 11)).foregroundColor(tint).frame(width: 12) }
                // The narrow layout never cuts a name: it takes a second line first.
                if dense { name.lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true) } else { name.lineLimit(1).truncationMode(.middle) }
                Spacer(minLength: 4)
                Text(byLoad ? "프로그램 실행 중" : "\(mark.label) \(sinceText(s.stateSince, now: snap.at))").font(.system(size: 11)).foregroundColor(pal.text2).lineLimit(1).fixedSize()
            }
            if dense { doingLine(s, pending, pal) } else {
                if let p = pending {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: toolSymbol(p.tool)).font(.system(size: 10)).foregroundColor(pal.text2).frame(width: 12, height: 14)
                        Text((p.target ?? "").isEmpty ? toolName(p.tool) : (p.target ?? "")).font(.system(size: 11.5)).foregroundColor(pal.text).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    }
                }
                ForEach(Array(model.working(s, max: 3).enumerated()), id: \.offset) { _, it in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Image(systemName: "gearshape.2.fill").font(.system(size: 9.5)).foregroundColor(pal.text2).frame(width: 12)
                            Text(it.name).font(.system(size: 11.5, weight: .medium)).foregroundColor(pal.text).lineLimit(1).truncationMode(.middle).help(it.name)
                        }
                        stats(it.w, pal).padding(.leading, 18)
                    }
                }
            }
            if !subs.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.turn.down.right").font(.system(size: 9.5, weight: .semibold)).foregroundColor(pal.text2).frame(width: 12)
                    Text("띄운 세션 \(subs.count)개").font(.system(size: 11.5)).foregroundColor(pal.text)
                    Spacer(minLength: 4)
                    Text("작업 중 \(subs.filter { model.phase($0) == .active }.count)").font(.system(size: 11, weight: .medium)).monospacedDigit().foregroundColor(pal.text)
                }
            }
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 8).fill(pal.well.opacity(0.55)))
        return Pressable(radius: 8, action: { pick(s) }) { row }.help(dense ? "누르면 이 세션이 열려 있는 터미널로 갑니다" : "")
    }
    /** What a working session does right now, in one line: the tool call in flight, else its heaviest program, else that it is writing. Its context fill sits at the end. */
    @ViewBuilder func doingLine(_ s: Session, _ pending: ToolCall?, _ pal: Pal) -> some View {
        let top = model.working(s, max: 1).first
        let what: (symbol: String, text: String)? = pending.map { p in (toolSymbol(p.tool), (p.target ?? "").isEmpty ? toolName(p.tool) : (p.target ?? "")) }
            ?? top.map { ("gearshape.2.fill", $0.name) } ?? (s.state == "busy" ? ("ellipsis.bubble.fill", "응답을 쓰는 중") : nil)
        let ctx = s.context?.pct
        if what != nil || ctx != nil {
            HStack(alignment: .top, spacing: 6) {
                if let w = what {
                    Image(systemName: w.symbol).font(.system(size: 10)).foregroundColor(pal.text2).frame(width: 12, height: 14)
                    Text(w.text).font(.system(size: 11.5)).foregroundColor(pal.text).lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                if let p = ctx { Text("컨텍스트 \(Int(p))%").font(.system(size: 10.5)).monospacedDigit().foregroundColor(severity(p, pal.text2, pal, warnAt: 80, critAt: 95).color).lineLimit(1).fixedSize() }
            }
        }
    }
    /** A session resting at its prompt: one quiet line. */
    func idleRow(_ s: Session, _ snap: Snapshot, _ pal: Pal, dense: Bool, pick: @escaping (Session) -> Void) -> some View {
        let name = Text(s.label).font(.system(size: 12)).foregroundColor(pal.text2)
        return Pressable(radius: 6, action: { pick(s) }) {
            HStack(alignment: dense ? .top : .center, spacing: 6) {
                Image(systemName: "pause.circle").font(.system(size: 11)).foregroundColor(pal.text2).frame(width: 12)
                if dense { name.lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true) } else { name.lineLimit(1).truncationMode(.middle) }
                Spacer(minLength: 4)
                Text(sinceText(s.stateSince, now: snap.at)).font(.system(size: 10.5)).foregroundColor(pal.text2).fixedSize()
            }.padding(.vertical, 5).padding(.horizontal, 10).frame(maxWidth: .infinity, alignment: .leading)
        }.help(dense ? "누르면 이 세션이 열려 있는 터미널로 갑니다" : "")
    }
    /**
     * Who is working or waiting for the user, then who rests at the prompt, as rows that can be pressed. It fills the width
     * it is given: the right column gives it 372 points, the narrow layout the whole window.
     */
    func nowList(_ snap: Snapshot, _ pal: Pal, dense: Bool, pick: @escaping (Session) -> Void) -> some View {
        let everyone = model.ordered(snap.sessions)
        let all = everyone.filter { model.parentSession[$0.pid] == nil }
        let subsOf: (Session) -> [Session] = { up in everyone.filter { model.parentSession[$0.pid] == up.pid } }
        let busy: (Session) -> Bool = { s in model.phase(s) != .idle || subsOf(s).contains { model.phase($0) != .idle } }
        let live = all.filter { busy($0) }, idle = all.filter { !busy($0) }
        return VStack(alignment: .leading, spacing: 10) {
            if live.isEmpty { Text("작업 중인 세션이 없습니다").font(.system(size: 12)).foregroundColor(pal.text2) }
            ForEach(live) { s in liveRow(s, snap, pal, subs: subsOf(s), dense: dense, pick: pick) }
            if !idle.isEmpty {
                Text("입력 대기").font(.system(size: 11)).foregroundColor(pal.text2).padding(.top, 4)
                ForEach(idle) { s in idleRow(s, snap, pal, dense: dense, pick: pick) }
            }
            if model.leftover.n > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "moon.zzz.fill").font(.system(size: 11)).foregroundColor(pal.left).frame(width: 12)
                    Text("끝난 세션이 남긴 프로세스 \(model.leftover.n)개").font(.system(size: 11.5)).foregroundColor(pal.text)
                    Spacer(minLength: 4)
                    Text("\(pct1(model.leftover.cpu * 100)), \(memText(model.leftover.mem))").font(.system(size: 11, weight: .medium)).monospacedDigit().foregroundColor(pal.text).fixedSize()
                }.padding(.top, 6).padding(.horizontal, 10)
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }
    /** The right column while no session is picked: what is running now, whoever needs the user first. Picking a session shows its detail in this same column. */
    func nowColumn(_ snap: Snapshot, _ pal: Pal) -> some View {
        let body = VStack(alignment: .leading, spacing: 10) {
            Text("지금 도는 것").font(.system(size: 15, weight: .semibold)).foregroundColor(pal.text)
            nowList(snap, pal, dense: false, pick: { selected = $0.pid })
            Divider().padding(.vertical, 4)
            trends(pal)
        }.padding(14).frame(width: 372, alignment: .topLeading)
        return Group { if still { body } else { ScrollView { body } } }
    }
    /** What scrolls under the band: the machine detail when it is open, then the project groups. */
    func scrollRegion(_ snap: Snapshot, _ pal: Pal, inner: CGFloat) -> some View {
        let body = VStack(alignment: .leading, spacing: 12) {
            if showDetail {
                machine(snap, pal, width: inner)
                if model.gpu != nil { gpuCard(snap, pal) }
            }
            if snap.sessions.isEmpty { Text("실행 중인 세션이 없습니다").font(.system(size: 13)).foregroundColor(pal.text2).padding(.top, 20).frame(maxWidth: .infinity) } else { groupsView(snap, pal, width: inner) }
        }
        return Group { if still { body } else { ScrollView { body } } }
    }
    /** The band, the warnings and the scroll region. The band and the warnings stay put while the rest scrolls. */
    func leftColumn(_ pal: Pal, inner: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let snap = model.snap {
                band(snap, pal)
                if let ws = snap.warnings, !ws.isEmpty { warnChips(ws, pal) }
                if snap.sessions.isEmpty && !showDetail { Text("실행 중인 세션이 없습니다").font(.system(size: 13)).foregroundColor(pal.text2).frame(maxWidth: .infinity, maxHeight: .infinity) }
                else { scrollRegion(snap, pal, inner: inner) }
            } else {
                Text(model.failure ?? "불러오는 중입니다").font(.system(size: 13)).foregroundColor(pal.text2).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }.padding(.horizontal, 18).padding(.bottom, 18).padding(.top, still ? 12 : TITLE_BAR + 10).frame(maxWidth: .infinity, maxHeight: still ? nil : .infinity, alignment: .topLeading)
    }
    /** Wide: the left column and a 372 point column on the right that holds what is running now, or the picked session. */
    func largeLayout(_ pal: Pal, width: CGFloat) -> some View {
        let open = selected.flatMap { pid in model.snap?.sessions.first { $0.pid == pid } }
        return HStack(alignment: .top, spacing: 0) {
            leftColumn(pal, inner: max(318, width - 372 - 36))
            if let snap = model.snap {
                Group { if let s = open { inspector(s, snap, pal) } else { nowColumn(snap, pal) } }.padding(.top, still ? 0 : TITLE_BAR + 10).frame(width: 372, alignment: .top)
            }
        }.background(alignment: .topTrailing) { Rectangle().fill(pal.tile).frame(width: 372) }
    }
    /** Middle: no right column. A picked session's detail lies over the trailing edge, so nothing under it moves when it opens or closes. */
    func mediumLayout(_ pal: Pal, width: CGFloat) -> some View {
        let open = selected.flatMap { pid in model.snap?.sessions.first { $0.pid == pid } }
        return ZStack(alignment: .topTrailing) {
            leftColumn(pal, inner: width - 36)
            if let s = open, let snap = model.snap {
                inspector(s, snap, pal).padding(.top, still ? 0 : TITLE_BAR + 10).frame(width: 372).frame(maxHeight: still ? nil : .infinity, alignment: .top)
                    .background(pal.tile).shadow(color: Color.black.opacity(pal.dark ? 0.5 : 0.2), radius: 10, x: -4, y: 0)
            }
        }
    }
    func metric(_ label: String, _ value: String, _ pal: Pal, color: Color? = nil) -> some View {
        HStack(spacing: 3) {
            Text(label).font(.system(size: 10.5)).foregroundColor(pal.text2)
            Text(value).font(.system(size: 11, weight: .medium)).monospacedDigit().foregroundColor(color ?? pal.text)
        }.lineLimit(1).fixedSize()
    }
    /** The machine figures and the account limits on one line, the limits dropped one by one when the width runs out. */
    func metricsLine(_ snap: Snapshot, _ pal: Pal, limits: Int) -> some View {
        let wins = Array((snap.usage?.claude?.windows ?? []).prefix(limits))
        return HStack(spacing: 10) {
            metric("CPU", pct1(cpuSplit(snap, pal).total), pal)
            metric("메모리", memText(memSplit(snap, pal).total), pal)
            if model.gpu != nil { metric("GPU", pct1(gpuSplit(snap, pal).total), pal) }
            ForEach(wins, id: \.key) { w in metric("\(windowName(w)) 한도", "\(Int(w.usedPct.rounded()))%", pal, color: severity(w.usedPct, pal.text, pal).color) }
            Spacer(minLength: 0)
        }
    }
    func miniHeader(_ snap: Snapshot, _ pal: Pal) -> some View {
        let n = counts(snap)
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                if n.active > 0 { LiveDot(color: pal.good) }
                Text("작업 중 \(n.active)").font(.system(size: 15, weight: .semibold)).foregroundColor(pal.text).fixedSize()
                Text("/ \(n.mains)").font(.system(size: 12)).foregroundColor(pal.text2).fixedSize()
                Spacer(minLength: 6)
                if n.user > 0 { chip("hand.raised.fill", pal.warning, "확인 대기 \(n.user)", pal) }
                if n.idle > 0 { chip("pause.circle", pal.text2, "입력 대기 \(n.idle)", pal) }
            }
            ViewThatFits(in: .horizontal) {
                metricsLine(snap, pal, limits: 4)
                metricsLine(snap, pal, limits: 1)
                metricsLine(snap, pal, limits: 0)
            }
        }.padding(.horizontal, 12).padding(.top, still ? 10 : TITLE_BAR + 6).padding(.bottom, 8)
    }
    /** Narrow: one column of sessions on the tile colour, a header with the counts and the machine, and every session as a row. */
    func miniLayout(_ pal: Pal) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let snap = model.snap {
                miniHeader(snap, pal)
                if let ws = snap.warnings, !ws.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(ws) { w in
                            HStack(alignment: .top, spacing: 6) {
                                warnIcon(w, pal).frame(height: 15)
                                Text(warnText(w)).font(.system(size: 12, weight: .medium)).foregroundColor(pal.text).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }.help(w.advice?.first?.tip ?? w.advice?.first?.title ?? "")
                        }
                    }.padding(.horizontal, 12).padding(.bottom, 8)
                }
                Divider()
                let list = nowList(snap, pal, dense: true, pick: { jump(to: $0) }).padding(10)
                if still { list } else { ScrollView { list } }
            } else {
                Text(model.failure ?? "불러오는 중입니다").font(.system(size: 13)).foregroundColor(pal.text2).padding(.top, still ? 10 : TITLE_BAR + 6).padding(.horizontal, 12).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }.frame(maxWidth: .infinity, maxHeight: still ? nil : .infinity, alignment: .topLeading).background(pal.tile)
    }
    func content(_ width: CGFloat) -> some View {
        let pal = Pal(dark: scheme == .dark)
        let mode = DashSize.of(width)
        return Group {
            switch mode {
            case .large: largeLayout(pal, width: width)
            case .medium: mediumLayout(pal, width: width)
            case .mini: miniLayout(pal)
            }
        }.frame(minWidth: mode == .large ? 1100 : mode == .medium ? 620 : 300, maxWidth: .infinity, minHeight: 200, maxHeight: still ? nil : .infinity, alignment: .topLeading)
            .background(pal.surface)
    }
    var body: some View {
        if still { content(stillWidth) } else { GeometryReader { g in content(g.size.width) }.ignoresSafeArea() }
    }
}
/** The animal is a rank, so the rank is said beside it: which species, where in the company, and what comes next. */
struct RankHead: View {
    let st: Standing
    var body: some View {
        let place: String = st.idle == true ? "이번 달 사용 기록 없음" : (st.rank != nil && st.ranked != nil ? "종합 \(Int(st.ranked!))명 중 \(Int(st.rank!))위" : "순위 집계 전")
        let parts: [String] = [st.scorePct.map { "점수 백분위 \(Int($0))%" } ?? "", st.next.map { "다음 \($0.emoji) \($0.name)" + ($0.floorPct.map { " \(Int($0))%부터" } ?? "") } ?? "",
                               st.next == nil && st.spendRank != nil && st.dlgRank != nil ? "사용량 \(Int(st.spendRank!))위, 위임 비율 \(Int(st.dlgRank!))위" : ""].filter { !$0.isEmpty }
        HStack(spacing: 9) {
            Text(st.emoji).font(.system(size: 25))
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Text("이달의 랭킹").font(.system(size: 10.5, weight: .medium)).foregroundColor(.secondary)
                    if st.crown == true { Image(systemName: "crown.fill").font(.system(size: 9.5)).foregroundColor(.yellow) }
                }
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(st.name).font(.system(size: 14, weight: .semibold))
                    Text(place).font(.system(size: 12.5)).monospacedDigit()
                }.lineLimit(1)
                if !parts.isEmpty { Text(parts.joined(separator: ", ")).font(.system(size: 10.5)).foregroundColor(.secondary).lineLimit(2).fixedSize(horizontal: false, vertical: true) }
            }
        }
    }
}
struct LimitLine: Identifiable { let id: String; let agent: String; let name: String; let pct: Double; let reset: String }
func planName(_ p: String?) -> String? {
    guard let p = p, !p.isEmpty else { return nil }
    return p == "free" ? "무료 플랜" : "\(p.prefix(1).uppercased())\(p.dropFirst()) 플랜"
}
/** How old a figure is, said only once it is old enough to matter. */
func ageText(_ at: Double?, now: Double) -> String? {
    guard let at = at else { return nil }
    let min = Int((now - at) / 60000); if min < 10 { return nil }
    return min < 60 ? "\(min)분 전 기록" : "\(min / 60)시간 전 기록"
}
struct PanelView: View {
    @ObservedObject var model: Model
    @ObservedObject var prefs: Prefs
    @ObservedObject var nav: Nav
    @ObservedObject var book: RuleBook
    var still = false  // a rendered capture shows the whole page, without the scroll view
    var lit: Int? = nil  // draw this session's row as if the pointer were on it, for a capture
    @Environment(\.colorScheme) private var scheme
    var maxHeight: CGFloat = 900
    var onMenu: () -> Void = {}
    var onDashboard: () -> Void = {}
    func limits(_ snap: Snapshot) -> [LimitLine] {
        var out: [LimitLine] = []
        // An account limit says nothing to someone who is not running that agent: Codex shows only while a Codex session runs.
        let codex = snap.sessions.contains { $0.agent == "codex" }
        for (agent, l) in [("claude", snap.usage?.claude), ("codex", codex ? snap.usage?.codex : nil)] {
            // The Codex figure is whatever its last run wrote down, so say which plan it is and how old the record is.
            let about = [planName(l?.plan), ageText(l?.at, now: snap.at)].compactMap { $0 }
            for w in l?.windows ?? [] {
                let r = resetText(w.resetsAt, now: snap.at)
                out.append(LimitLine(id: "\(agent)-\(w.key)", agent: agent, name: windowName(w), pct: w.usedPct, reset: (about + (r.isEmpty ? [] : [r])).joined(separator: ", ")))
            }
        }
        return out
    }
    var body: some View {
        Group {
            switch nav.page {
            case .status: status
            case .settings: SettingsView(prefs: prefs, back: { nav.page = .status })
            case .rules: RulesView(book: book, limit: maxHeight, back: { nav.page = .status })
            case .session(let pid):
                let s = model.snap?.sessions.first { $0.pid == pid }
                SessionView(s: s, cpu: s.map { model.cpuOf($0) } ?? 0, mem: s.map { model.memOf($0) } ?? 0, now: model.snap?.at ?? 0, off: model.detailOff, limit: maxHeight, back: { nav.page = .status })
            case .warning(let chip): WarningView(w: model.snap?.warnings?.first { $0.chip == chip }, now: model.snap?.at ?? 0, limit: maxHeight, back: { nav.page = .status })
            }
        }
        // A page that still comes out taller than the screen loses its bottom, never the header with the back and menu buttons.
        .frame(maxHeight: still ? nil : maxHeight, alignment: .top)
    }
    /** How many sessions, and how they stand: working, waiting for a go-ahead, waiting for input. Sessions another one started are counted apart. */
    func sessionsTitle(_ snap: Snapshot) -> String {
        let mains = snap.sessions.filter { model.parentSession[$0.pid] == nil }, phases = mains.map { model.phase($0) }
        var parts = ["세션 \(mains.count)개", "작업 중 \(phases.filter { $0 == .active }.count)"]
        let user = phases.filter { $0 == .needsUser }.count, idle = phases.filter { $0 == .idle }.count
        if user > 0 { parts.append("확인 대기 \(user)") }
        if idle > 0 { parts.append("입력 대기 \(idle)") }
        if snap.sessions.count > mains.count { parts.append("띄운 세션 \(snap.sessions.count - mains.count)") }
        return parts.joined(separator: ", ")
    }
    func headButton(_ symbol: String, _ tip: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 14, weight: .medium)).frame(width: 26, height: 22).contentShape(Rectangle()) }.buttonStyle(HoverStyle(radius: 6)).help(tip)
    }
    var status: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if let st = model.snap?.standing { RankHead(st: st) } else {
                    Text("✇").font(.system(size: 17))
                    Text("Sprag").font(.system(size: 15, weight: .medium)).foregroundColor(.secondary)
                }
                Spacer()
                headButton("rectangle.grid.2x2", "대시보드", onDashboard)
                headButton("checklist", "규칙") { nav.page = .rules }
                headButton("gearshape", "설정") { nav.page = .settings }
                headButton("ellipsis", "메뉴", onMenu)
            }.padding(.horizontal, 4)
            if let snap = model.snap {
                // The whole card scrolls once it is taller than the screen; guessing which block to shrink went wrong as blocks were added.
                FitScroll(limit: maxHeight - 92, still: still) { VStack(spacing: 0) {
                    let cpuAll = model.share(nil), memAll = model.mem(nil)
                    let hasCodex = snap.sessions.contains { $0.agent == "codex" }
                    let warns = snap.warnings ?? []
                    if !warns.isEmpty {
                        WarningList(warnings: warns) { nav.page = .warning($0.chip) }
                        Divider().padding(.horizontal, 12)
                    }
                    Block(symbol: "terminal", title: snap.totals.sessions == 0 ? "실행 중인 세션 없음" : sessionsTitle(snap)) {
                        let groups = groupSessions(model.ordered(snap.sessions), parents: model.parentSession)
                        let rows = VStack(alignment: .leading, spacing: 0) {
                            ForEach(groups) { g in
                                let many = g.sessions.count > 1
                                if many {
                                    HStack(spacing: 5) {
                                        Image(systemName: "folder.fill").font(.system(size: 10))
                                        Text(g.name).font(.system(size: 11, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                                        Text("세션 \(g.sessions.count)개").font(.system(size: 10.5))
                                        Spacer(minLength: 0)
                                    }.foregroundColor(.secondary).padding(.top, 8).padding(.bottom, 2)
                                }
                                VStack(alignment: .leading, spacing: 0) {
                                    // A session that another one here started is one line under it, as on the dashboard: they come in batches.
                                    ForEach(g.sessions) { s in
                                        let sub = model.parentSession[s.pid].map { up in g.sessions.contains { $0.pid == up } } ?? false
                                        if sub {
                                            Pressable(radius: 9, action: { nav.page = .session(s.pid) }) { SubTile(s: s, now: snap.at, selected: false, pal: Pal(dark: scheme == .dark), phase: model.phase(s)) }
                                                .padding(.vertical, 2).help("눌러서 이 세션의 상세 보기")
                                        } else {
                                            if s.id != g.sessions.first?.id { Divider() }
                                            Button(action: { nav.page = .session(s.pid) }) { SessionRow(s: s, cpu: model.cpuOf(s), mem: model.memOf(s), now: snap.at).contentShape(Rectangle()) }
                                                .buttonStyle(HoverStyle(radius: 7, grow: 4, lit: lit == s.pid)).help("눌러서 이 세션의 상세 보기")
                                        }
                                    }
                                }.padding(.leading, many ? 10 : 0).overlay(alignment: .leading) { if many { Rectangle().fill(Color.primary.opacity(0.22)).frame(width: 2).padding(.vertical, 7) } }
                                if g.id != groups.last?.id { Divider() }
                            }
                        }
                        rows
                    }
                    Divider().padding(.horizontal, 12)
                    let pal = Pal(dark: scheme == .dark), sm = model.samples, span = spanText(sm.first?.at, sm.last?.at)
                    let cpuCl = model.share("claude"), cpuCx = model.share("codex"), cpuLeft = model.leftover.cpu * 100
                    let cpuDev = max((model.sysCpu ?? 0) * 100, cpuAll + cpuLeft)
                    let memCl = model.mem("claude"), memCx = model.mem("codex"), memLeft = model.leftover.mem, memOther = model.others.reduce(0) { $0 + $1.mem }
                    let grey = Color.primary.opacity(0.35)
                    // The machine's total and who makes it up, as parts of one bar; then a trend with its scale written on it.
                    Block(symbol: "cpu", title: "CPU: 기기 전체 \(pct1(cpuDev)), 세션 \(pct1(cpuAll))") {
                        SplitBar(parts: [(cpuCl, CLAUDE), (cpuCx, CODEX), (cpuLeft, LEFT), (max(0, cpuDev - cpuAll - cpuLeft), grey)], scale: 100).padding(.vertical, 2)
                        Legend(color: CLAUDE, label: "Claude 세션:", value: pct1(cpuCl))
                        if hasCodex { Legend(color: CODEX, label: "Codex 세션:", value: pct1(cpuCx)) }
                        if model.leftover.n > 0 { Legend(color: LEFT, label: "끝난 세션이 남긴 것:", value: "\(pct1(cpuLeft)), 프로세스 \(model.leftover.n)개") }
                        Legend(color: grey, label: "그 밖:", value: pct1(max(0, cpuDev - cpuAll - cpuLeft)))
                        TrendChart(title: "추이", lines: [.init(id: "기기 전체", values: sm.map { $0.sysCpu * 100 }, color: pal.neutral, fill: true), .init(id: "세션", values: sm.map { ($0.claudeCpu + $0.codexCpu) * 100 }, color: CLAUDE)],
                                   top: 100, fmt: { "\(Int($0.rounded()))%" }, span: span, pal: pal, height: 34).padding(.top, 4)
                    }
                    Divider().padding(.horizontal, 12)
                    Block(symbol: "memorychip", title: "메모리: 기기 전체 \(memText(model.sysMemMb)), 세션 \(memText(memAll))") {
                        SplitBar(parts: [(memCl, CLAUDE), (memCx, CODEX), (memLeft, LEFT), (memOther, grey)], scale: RAM_MB).padding(.vertical, 2)
                        Legend(color: CLAUDE, label: "Claude 세션:", value: memText(memCl))
                        if hasCodex { Legend(color: CODEX, label: "Codex 세션:", value: memText(memCx)) }
                        if model.leftover.n > 0 { Legend(color: LEFT, label: "끝난 세션이 남긴 것:", value: memText(memLeft)) }
                        Legend(color: grey, label: "다른 프로그램:", value: memText(memOther))
                        TrendChart(title: "추이", lines: [.init(id: "기기 전체", values: sm.map { $0.sysMem * RAM_MB }, color: pal.neutral, fill: true), .init(id: "세션", values: sm.map { ($0.claudeMem + $0.codexMem) * RAM_MB }, color: CLAUDE)],
                                   top: RAM_MB, fmt: { memText($0) }, span: span, pal: pal, height: 34).padding(.top, 4)
                    }
                    if let g = model.gpu {
                        Divider().padding(.horizontal, 12)
                        Block(symbol: "display", title: "GPU: \(pct1(g * 100))") {
                            let gCl = min(100, snap.sessions.filter { $0.agent != "codex" }.reduce(0) { $0 + (model.gpuBySession[$1.pid] ?? 0) } * 100)
                            let gCx = min(100, snap.sessions.filter { $0.agent == "codex" }.reduce(0) { $0 + (model.gpuBySession[$1.pid] ?? 0) } * 100)
                            let gLeft = min(100, model.gpuUse.filter { $0.left }.reduce(0) { $0 + $1.share } * 100)
                            SplitBar(parts: [(gCl, CLAUDE), (gCx, CODEX), (gLeft, LEFT), (max(0, g * 100 - gCl - gCx - gLeft), grey)], scale: 100).padding(.vertical, 2)
                            Legend(color: CLAUDE, label: "Claude 세션:", value: pct1(gCl))
                            if hasCodex { Legend(color: CODEX, label: "Codex 세션:", value: pct1(gCx)) }
                            if gLeft >= 0.1 { Legend(color: LEFT, label: "끝난 세션이 남긴 것:", value: pct1(gLeft)) }
                            Legend(color: grey, label: "그 밖:", value: "\(pct1(max(0, g * 100 - gCl - gCx - gLeft))), GPU 메모리 \(memText(model.gpuMemMb))")
                            Text("많이 쓰는 곳").font(.system(size: 10.5)).foregroundColor(.secondary).padding(.top, 3)
                            let lines = model.gpuLines(snap.sessions, max: 4)
                            ForEach(lines) { l in
                                HStack(spacing: 6) {
                                    RoundedRectangle(cornerRadius: 2).fill(l.agent == nil ? Color.primary.opacity(0.35) : l.agent == "left" ? LEFT : l.agent == "codex" ? CODEX : CLAUDE).frame(width: 9, height: 9)
                                    Text(l.label).lineLimit(1).truncationMode(.middle)
                                    if !l.note.isEmpty { Text(l.note).foregroundColor(.secondary).lineLimit(1).truncationMode(.tail) }
                                    Spacer(minLength: 4)
                                    Text(pct1(l.share * 100)).monospacedDigit()
                                }.font(.system(size: 12)).help(l.agent == nil ? "세션과 무관한 프로그램" : l.agent == "left" ? "끝난 세션이 남긴 프로세스" : "이 세션이 띄운 프로세스가 쓰는 GPU")
                            }
                            if lines.isEmpty { Text("지금 GPU를 쓰는 프로세스가 없습니다").font(.system(size: 10.5)).foregroundColor(.secondary) }
                            TrendChart(title: "추이", lines: [.init(id: "기기 전체", values: sm.map { $0.gpu * 100 }, color: pal.neutral, fill: true), .init(id: "세션", values: sm.map { ($0.claudeGpu + $0.codexGpu) * 100 }, color: CLAUDE)],
                                       top: 100, fmt: { "\(Int($0.rounded()))%" }, span: span, pal: pal, height: 34).padding(.top, 4)
                        }
                    }
                    Divider().padding(.horizontal, 12)
                    let lines = limits(snap)
                    Block(symbol: "speedometer", title: "사용량") {
                        if lines.isEmpty { Text("한도 정보가 아직 없습니다").font(.system(size: 12)).foregroundColor(.secondary) }
                        ForEach(lines) { l in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 7) {
                                    Badge(agent: l.agent)
                                    Text(l.name).font(.system(size: 12, weight: .medium)).frame(width: 62, alignment: .leading)
                                    Bar(value: l.pct / 100, tint: l.pct >= 90 ? .red : l.pct >= 70 ? .orange : agentTint(l.agent))
                                    Text("\(Int(l.pct.rounded()))%").font(.system(size: 12, weight: .medium)).monospacedDigit().frame(width: 38, alignment: .trailing)
                                }
                                if !l.reset.isEmpty { Text(l.reset).font(.system(size: 10.5)).foregroundColor(.secondary) }
                            }.padding(.top, 1)
                        }
                        if let c = snap.totals.costUsd {
                            HStack(spacing: 6) { Text("실행 중 세션 합계(정가 환산):").foregroundColor(.secondary); Text(String(format: "$%.2f", c)).monospacedDigit().fontWeight(.medium) }.font(.system(size: 12)).padding(.top, 3)
                        }
                    }
                } }.background(RoundedRectangle(cornerRadius: 12).fill(CARD_FILL)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.primary.opacity(0.10), lineWidth: 1))
            } else {
                Text(model.failure ?? "불러오는 중입니다").font(.system(size: 12.5)).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 26)
            }
        }.padding(12).frame(width: 408)
    }
}

// ---------- the menu bar item and its window ----------
final class FloatPanel: NSPanel { override var canBecomeKey: Bool { true } }
/**
 * The Dock icon while the dashboard is open: the member's town animal, white on a coral rounded square, the same
 * species that runs in the menu bar. It is one still frame, redrawn only when the grade changes; a running Dock icon
 * would spend CPU and pull the eye away from the dashboard. Drawn on the macOS icon grid (an 824 square in 1024).
 */
/**
 * Give the launcher bundle the CLI writes (~/Applications/Sprag Bar.app, src/bar-app.js installLauncher) the same icon
 * as the Dock, so Spotlight and Launchpad show the runner instead of a blank app. Only a bundle whose Info.plist names
 * the launcher's id is touched; a missing one is left for the CLI to write.
 */
func paintLauncher(_ icon: NSImage) {
    let path = NSHomeDirectory() + "/Applications/Sprag Bar.app"
    guard let plist = try? String(contentsOfFile: path + "/Contents/Info.plist", encoding: .utf8), plist.contains("io.sprag.bar-launcher") else { return }
    NSWorkspace.shared.setIcon(icon, forFile: path, options: [])
}
func dockIcon(_ grade: String?) -> NSImage {
    let sp = runnerSpecies(grade)
    // a frame that reads as that animal at rest in motion: wings up for fliers, mid-leap for the frog, a stride otherwise
    let frame = sp.fly > 0 || sp.x.contains("wings") ? 2 : sp.kind == 4 ? 2 : sp.kind == 7 ? 0 : sp.kind == 5 || sp.kind == 6 ? 1 : 7
    let still = runner(sp, frame: frame, idle: false)
    return NSImage(size: NSSize(width: 512, height: 512), flipped: false) { r in
        let k = r.width / 1024
        let body = NSRect(x: 100 * k, y: 100 * k, width: 824 * k, height: 824 * k)
        let shape = NSBezierPath(roundedRect: body, xRadius: 185 * k, yRadius: 185 * k)
        let top = NSColor(srgbRed: 0.941, green: 0.573, blue: 0.416, alpha: 1), bottom = NSColor(srgbRed: 0.788, green: 0.341, blue: 0.235, alpha: 1)
        NSGraphicsContext.saveGraphicsState()
        let sh = NSShadow(); sh.shadowColor = NSColor.black.withAlphaComponent(0.28); sh.shadowBlurRadius = 22 * k; sh.shadowOffset = NSSize(width: 0, height: -10 * k); sh.set()
        top.setFill(); shape.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSGradient(starting: top, ending: bottom)?.draw(in: shape, angle: -90)
        // a soft shadow on the ground under the animal
        NSColor(srgbRed: 0.478, green: 0.180, blue: 0.118, alpha: 0.35).setFill()
        NSBezierPath(ovalIn: NSRect(x: 262 * k, y: 262 * k, width: 500 * k, height: 44 * k)).fill()
        let w = 700 * k, h = w * still.size.height / still.size.width
        let white = NSImage(size: still.size, flipped: false) { rr in still.draw(in: rr); NSColor.white.set(); rr.fill(using: .sourceAtop); return true }
        white.draw(in: NSRect(x: r.midX - w / 2 + 10 * k, y: 250 * k, width: w, height: h))
        return true
    }
}
/** The few menu commands a window needs once the app is a regular one: close, minimise, quit. */
func dashboardMenu(_ app: App) -> NSMenu {
    let bar = NSMenu()
    let appItem = NSMenuItem(), appMenu = NSMenu()
    appMenu.addItem(NSMenuItem(title: "Sprag 끝내기", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    appItem.submenu = appMenu; bar.addItem(appItem)
    let winItem = NSMenuItem(), winMenu = NSMenu(title: "윈도우")
    winMenu.addItem(NSMenuItem(title: "닫기", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
    winMenu.addItem(NSMenuItem(title: "최소화", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
    winMenu.addItem(.separator())
    for (title, key, action) in [("작게", "1", #selector(App.dashMini)), ("중간", "2", #selector(App.dashMedium)), ("크게", "3", #selector(App.dashLarge)), ("항상 위에 두기", "", #selector(App.dashPinMenu))] {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: key); it.target = app; winMenu.addItem(it)
    }
    winItem.submenu = winMenu; bar.addItem(winItem)
    return bar
}
extension App: NSMenuItemValidation {
    /** The checkmark of "항상 위에 두기" follows the pin, whichever of the two controls changed it. */
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(App.dashPinMenu) { item.state = dashUI.pinned ? .on : .off }
        return true
    }
}
extension App: NSApplicationDelegate {
    /** A click on the Dock icon: show the dashboard again, wherever it went. */
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showDashboard(); return false }
    func applicationWillTerminate(_ notification: Notification) { if let dir = dataDir, selftest == nil { try? FileManager.default.removeItem(atPath: dir + "/bar-app.json") } }
}
final class App: NSObject {
    let model = Model()
    let prefs = Prefs()
    let nav = Nav()
    let book = RuleBook()
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var panel: FloatPanel!
    var hosting: NSHostingView<PanelView>!
    var frame = 0
    var outside: Any?, keys: Any?
    var dash: NSWindow?
    let dashUI = DashUI()
    var isOpen: Bool { panel.isVisible }
    var dashOpen: Bool { dash?.isVisible == true }
    /** Each session's work is asked for only while something that shows it is on screen. */
    func syncDetail() {
        var page = false
        if case .session = nav.page { page = true }
        let want = dashOpen || (isOpen && page)
        if want != model.wantDetail { model.wantDetail = want; if want { model.refresh() } }
    }
    @objc func showDashboard() {
        if isOpen { close() }
        if dash == nil {
            let room = NSScreen.main?.visibleFrame.size ?? NSSize(width: 1480, height: 900)
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: min(1480, room.width - 40), height: min(900, room.height - 60)), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            w.title = "Sprag 대시보드"; w.isReleasedWhenClosed = false; w.titlebarAppearsTransparent = true; w.minSize = NSSize(width: 300, height: 200)
            // A plain surface, not a see-through material: the chart colours were checked against this one.
            w.contentView = NSHostingView(rootView: DashboardView(model: model)); w.center()
            // The last size and place come back next time. The self-test keeps the default frame and leaves the user's saved one alone.
            if selftest == nil { w.setFrameUsingName("SpragDashboard"); w.setFrameAutosaveName("SpragDashboard"); dashUI.pinned = UserDefaults.standard.bool(forKey: "dashPinned") }
            w.level = dashUI.pinned ? .floating : .normal
            let controls = NSHostingView(rootView: DashControls(ui: dashUI, pick: { [weak self] in self?.setDashSize($0) }, pin: { [weak self] in self?.toggleDashPin() }))
            controls.frame.size = NSSize(width: controls.fittingSize.width, height: 28)
            let accessory = NSTitlebarAccessoryViewController(); accessory.view = controls; accessory.layoutAttribute = .right
            w.addTitlebarAccessoryViewController(accessory)
            NotificationCenter.default.addObserver(forName: NSWindow.didResizeNotification, object: w, queue: .main) { [weak self] _ in self?.syncDashSize() }
            NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in DispatchQueue.main.async { self?.syncDetail(); NSApp.setActivationPolicy(.accessory) } }
            dash = w
            syncDashSize()
        }
        // A menu bar app has no Dock icon, so a dashboard that slipped behind other windows could only be found through the
        // menu bar again. While the window is open the app is a regular one: Dock icon, app switcher, and a click on either brings it back.
        NSApp.setActivationPolicy(.regular)
        dockGrade = model.snap?.animal?.grade; NSApp.applicationIconImage = dockIcon(dockGrade)
        if NSApp.mainMenu == nil { NSApp.mainMenu = dashboardMenu(self) }
        NSApp.activate(ignoringOtherApps: true)
        if dash?.isMiniaturized == true { dash?.deminiaturize(nil) }
        dash?.makeKeyAndOrderFront(nil)
        syncDetail()
    }
    /** The control and the title follow the window's real width, so a dragged edge and a pressed preset end up the same. */
    func syncDashSize() {
        guard let w = dash, let v = w.contentView else { return }
        let s = DashSize.of(v.bounds.width)
        if dashUI.size != s { dashUI.size = s }
        let title: NSWindow.TitleVisibility = s == .mini ? .hidden : .visible   // the narrow title bar belongs to the controls
        if w.titleVisibility != title { w.titleVisibility = title }
    }
    /** Resize the window to one of the three layouts. The top edge stays, the side nearer the screen edge stays, and the result is kept on screen. */
    func setDashSize(_ s: DashSize, animate: Bool = true) {
        guard let w = dash else { return }
        let vis = (w.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1480, height: 900)
        let size: NSSize = s == .mini ? NSSize(width: 340, height: 480) : s == .medium ? NSSize(width: 780, height: 680) : NSSize(width: min(1480, vis.width - 40), height: min(900, vis.height - 60))
        let now = w.frame
        var f = NSRect(x: now.midX > vis.midX ? now.maxX - size.width : now.minX, y: now.maxY - size.height, width: size.width, height: size.height)
        f.size.width = min(f.width, vis.width); f.size.height = min(f.height, vis.height)
        f.origin.x = max(vis.minX, min(f.origin.x, vis.maxX - f.width)); f.origin.y = max(vis.minY, min(f.origin.y, vis.maxY - f.height))
        w.setFrame(f, display: true, animate: animate)
    }
    /** Keep the dashboard above other windows, and remember that for the next start. */
    @objc func toggleDashPin() {
        dashUI.pinned.toggle()
        dash?.level = dashUI.pinned ? .floating : .normal
        if selftest == nil { UserDefaults.standard.set(dashUI.pinned, forKey: "dashPinned") }
    }
    @objc func dashMini() { setDashSize(.mini) }
    @objc func dashMedium() { setDashSize(.medium) }
    @objc func dashLarge() { setDashSize(.large) }
    @objc func dashPinMenu() { toggleDashPin() }
    func start() {
        panel = FloatPanel(contentRect: NSRect(x: 0, y: 0, width: 408, height: 300), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true; panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        let fx = NSVisualEffectView(frame: panel.contentLayoutRect)
        fx.material = .popover; fx.blendingMode = .behindWindow; fx.state = .active
        fx.wantsLayer = true; fx.layer?.cornerRadius = 14; fx.layer?.masksToBounds = true
        let cap = (NSScreen.main?.visibleFrame.height ?? 900) - 12
        hosting = NSHostingView(rootView: PanelView(model: model, prefs: prefs, nav: nav, book: book, maxHeight: cap, onMenu: { [weak self] in self?.showMenu() }, onDashboard: { [weak self] in self?.showDashboard() }))
        // The page changed or its content grew: fit the window again once SwiftUI has laid it out.
        RELAYOUT = { [weak self] in DispatchQueue.main.async { if self?.isOpen == true { self?.place() } } }
        prefs.onLayout = RELAYOUT
        nav.onChange = { [weak self] page in
            guard let self = self else { return }
            if page == .settings { self.prefs.open() }
            if page == .rules { self.book.note = ""; self.book.failed = false; self.book.confirm = nil; self.book.expanded = nil; self.book.load() }
            self.syncDetail()
            RELAYOUT()
        }
        hosting.frame = fx.bounds; hosting.autoresizingMask = [.width, .height]
        fx.addSubview(hosting); panel.contentView = fx
        item.button?.imagePosition = .imageLeading
        item.button?.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        item.button?.target = self; item.button?.action = #selector(toggle)
        model.onUpdate = { [weak self] in self?.title(); if self?.isOpen == true { self?.place() } }
        animate(); poll()
    }
    func title() {
        guard let s = model.snap, let b = item.button else { item.button?.title = ""; return }
        let text = model.sysCpu != nil ? String(format: " %.0f%%", (model.sysCpu ?? 0) * 100) : " \(s.totals.busy)/\(s.totals.sessions)"
        let out = NSMutableAttributedString()
        if let w = s.warnings, !w.isEmpty {  // the statusline's warning, where it is seen without looking at a terminal
            let tint = w.contains { $0.level == "critical" } ? NSColor.systemRed : NSColor.systemOrange
            // Two palette colours: with one, the exclamation mark took the triangle's colour and vanished.
            let conf = NSImage.SymbolConfiguration(pointSize: 13, weight: .bold).applying(NSImage.SymbolConfiguration(paletteColors: [NSColor.white, tint]))
            if let sym = NSImage(systemSymbolName: "exclamationmark.triangle.fill", accessibilityDescription: "경고")?.withSymbolConfiguration(conf) {
                let a = NSTextAttachment(); a.image = sym; a.bounds = NSRect(x: 0, y: -2, width: sym.size.width, height: sym.size.height)
                out.append(NSAttributedString(string: " ")); out.append(NSAttributedString(attachment: a))
            }
        }
        if model.sysCpu != nil, let chip = NSImage(systemSymbolName: "cpu", accessibilityDescription: "CPU")?.withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 10.5, weight: .regular)) {
            chip.isTemplate = true
            let a = NSTextAttachment(); a.image = chip; a.bounds = NSRect(x: 0, y: -1.5, width: chip.size.width, height: chip.size.height)
            out.append(NSAttributedString(string: " ")); out.append(NSAttributedString(attachment: a))
        }
        out.append(NSAttributedString(string: text, attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular), .foregroundColor: NSColor.labelColor, .baselineOffset: 0.5]))
        b.attributedTitle = out
        b.toolTip = model.sysCpu != nil ? String(format: "기기 전체 CPU %.0f%%, 그중 AI 세션 %.0f%%. 세션 %d개 실행 중", (model.sysCpu ?? 0) * 100, model.share(nil), s.totals.sessions) : "작업 중인 세션 수 / 실행 중인 세션 수"
    }
    var dockGrade: String? = nil   // the grade the Dock icon was drawn for
    var launcherGrade: String?? = .none   // the grade the launcher's icon was drawn for, .none until the first snapshot
    func animate() {
        if NSApp.activationPolicy() == .regular, model.snap?.animal?.grade != dockGrade {
            dockGrade = model.snap?.animal?.grade; NSApp.applicationIconImage = dockIcon(dockGrade)
        }
        if selftest == nil, let snap = model.snap, launcherGrade != .some(snap.animal?.grade) {
            launcherGrade = .some(snap.animal?.grade); paintLauncher(dockIcon(snap.animal?.grade))
        }
        // RunCat's rule, on the same thing RunCat measures: the whole machine. A runner that strolls while the machine is
        // flat out, because the agent sessions' own share happens to be small, reads as wrong.
        let load = min(100, max(0, (model.sysCpu ?? 0) * 100))
        item.button?.image = runner(runnerSpecies(model.snap?.animal?.grade), frame: frame, idle: load < 5)
        frame += 1
        // RunCat's own curve: one stride takes (100 - load) / 60 seconds, so the pace climbs steeply as the machine fills up.
        // The stride is spread over this runner's poses, and a frame never comes faster than a display shows it.
        let gap = load < 5 ? 0.8 : max(1.0 / 60, (100 - load) / 60 / Double(GAL.count))
        DispatchQueue.main.asyncAfter(deadline: .now() + gap) { [weak self] in self?.animate() }
    }
    func poll() {
        model.refresh()
        DispatchQueue.main.asyncAfter(deadline: .now() + (isOpen ? 2 : dashOpen ? 3 : 4)) { [weak self] in self?.poll() }
    }
    /** Size the window to its content and hang it under the menu bar item, wholly inside the screen. */
    func place() {
        guard let b = item.button, let bw = b.window, let screen = bw.screen ?? NSScreen.main else { return }
        // The content's own height limit follows the screen the menu bar item is on. Set once from the main screen at
        // launch, it let a page grow taller than a shorter screen's window, and the window cut the page off at the top.
        let cap = screen.visibleFrame.height - 12
        if abs(hosting.rootView.maxHeight - cap) > 0.5 { var v = hosting.rootView; v.maxHeight = cap; hosting.rootView = v }
        hosting.layoutSubtreeIfNeeded()
        let vis = screen.visibleFrame, fit = hosting.fittingSize
        let w = fit.width, h = min(fit.height, vis.height - 12)
        let anchor = bw.convertToScreen(b.convert(b.bounds, to: nil))
        let x = min(max(anchor.midX - w / 2, vis.minX + 8), vis.maxX - w - 8)
        let top = min(anchor.minY - 5, vis.maxY - 5)
        panel.setFrame(NSRect(x: x, y: top - h, width: w, height: h), display: true)
    }
    func showMenu() {
        let m = NSMenu()
        let r = NSMenuItem(title: "지금 새로 고침", action: #selector(refreshNow), keyEquivalent: "r"); r.target = self; m.addItem(r)
        let d = NSMenuItem(title: "대시보드", action: #selector(showDashboard), keyEquivalent: "d"); d.target = self; m.addItem(d)
        let k = NSMenuItem(title: "규칙…", action: #selector(showRules), keyEquivalent: ""); k.target = self; m.addItem(k)
        let g = NSMenuItem(title: "설정…", action: #selector(showSettings), keyEquivalent: ","); g.target = self; m.addItem(g)
        m.addItem(.separator())
        let off = NSMenuItem(title: "자동으로 띄우지 않기 (sprag bar off)", action: #selector(turnOff), keyEquivalent: ""); off.target = self; m.addItem(off)
        let q = NSMenuItem(title: "Sprag Bar 끝내기", action: #selector(quit), keyEquivalent: "q"); q.target = self; m.addItem(q)
        m.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }
    @objc func refreshNow() { model.refresh() }
    @objc func showSettings() { nav.page = .settings }
    @objc func showRules() { nav.page = .rules }
    @objc func quit() { NSApp.terminate(nil) }
    /** `sprag bar off` records the choice and stops this app; quitting alone only lasts until the next session starts. */
    @objc func turnOff() { sprag(["bar", "off"], timeout: 8) { _, _, _ in NSApp.terminate(nil) } }
    @objc func toggle() {
        // The second click of a double click: the first one opened or closed the panel, this one asks for the dashboard.
        if NSApp.currentEvent?.clickCount == 2 { showDashboard(); return }
        if isOpen { close() } else { open() }
    }
    func open() {
        model.refresh(); place(); panel.orderFrontRegardless(); panel.makeKey(); item.button?.highlight(true)
        outside = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in self?.close() }
        keys = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] e in if e.keyCode == 53 { self?.close(); return nil }; return e }
    }
    func close() {
        panel.orderOut(nil); item.button?.highlight(false)
        if nav.page != .status { nav.page = .status }  // the next click opens on the status page
        syncDetail()
        if let m = outside { NSEvent.removeMonitor(m); outside = nil }
        if let m = keys { NSEvent.removeMonitor(m); keys = nil }
    }
}

var args = Array(CommandLine.arguments.dropFirst())
var ttl: Double = 0, selftest: String? = nil, selftestWrite = false, selftestWait = 9.5   // ttl 0: run until quit
var selftestClean: String? = nil   // self-test only: the one leftover line to stop, by its exact name
var dataDir: String? = nil, versionTag = ""   // where sprag keeps its state, and the sprag version that built this copy
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let main = App()
app.delegate = main   // after main exists: a global read before its own line is still empty
while !args.isEmpty {
    let a = args.removeFirst()
    switch a {
    case "--node": NODE = args.removeFirst()
    case "--cli": CLI = args.removeFirst()
    case "--trace": TRACE = true
    case "--selftest-write": selftestWrite = true
    case "--selftest-wait": selftestWait = Double(args.removeFirst()) ?? 9.5  // a longer wait gathers more history for the trend lines
    case "--ttl": ttl = Double(args.removeFirst()) ?? 0
    case "--data-dir": dataDir = args.removeFirst()
    case "--selftest-clean": selftestClean = args.removeFirst()
    case "--version-tag": versionTag = args.removeFirst()
    case "--selftest": selftest = args.removeFirst()
    default: break
    }
}
func png(_ image: NSImage, _ path: String) {
    guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let data = rep.representation(using: .png, properties: [:]) else { return }
    try? data.write(to: URL(fileURLWithPath: path)); print("SNAP \(path)")
}
/** A view as the window really draws it, laid over roughly the colour the window's material has (the material itself is not captured). */
func liveShot(_ view: NSView, _ path: String, forceDark: Bool = false) {
    guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
    view.cacheDisplay(in: view.bounds, to: rep)
    let dark = forceDark || view.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    guard let out = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: rep.pixelsWide, pixelsHigh: rep.pixelsHigh, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let ctx = NSGraphicsContext(bitmapImageRep: out) else { return }
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = ctx
    let r = NSRect(x: 0, y: 0, width: rep.pixelsWide, height: rep.pixelsHigh)
    (dark ? NSColor(white: 0.17, alpha: 1) : NSColor(white: 0.93, alpha: 1)).setFill(); r.fill(); rep.draw(in: r)
    NSGraphicsContext.restoreGraphicsState()
    if let data = out.representation(using: .png, properties: [:]) { try? data.write(to: URL(fileURLWithPath: path)); print("SNAP \(path) (\(dark ? "dark" : "light") appearance)") }
}
func fitCheck(_ label: String) {
    guard let screen = main.panel.screen ?? NSScreen.main else { return }
    let f = main.panel.frame, vis = screen.visibleFrame, fit = main.hosting.fittingSize
    print("\(label) GEOMETRY panel \(Int(f.width))x\(Int(f.height)) top \(Int(f.maxY)) | visible top \(Int(vis.maxY)) bottom \(Int(vis.minY)) | content \(Int(fit.width))x\(Int(fit.height))")
    print("\(label) CHECK top inside screen: \(f.maxY <= vis.maxY) | bottom inside screen: \(f.minY >= vis.minY) | whole content shown: \(f.height >= fit.height - 0.5) | right inside: \(f.maxX <= vis.maxX)")
}
@MainActor func render<V: View>(_ view: V, _ path: String, dark: Bool = true) {
    let r = ImageRenderer(content: view.background(dark ? Color(white: 0.17) : Color(white: 0.93)).environment(\.colorScheme, dark ? .dark : .light))
    r.scale = 2
    if let img = r.nsImage { png(img, path) }
}
let SANDBOX = ProcessInfo.processInfo.environment["SPRAGBAR_SANDBOX"] == "1" && ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"] != nil
typealias Step = (String, (@escaping () -> Void) -> Void, () -> Bool)
/** Run the steps one after another. Each reports whether what the CLI reads back is what the step meant to set. */
func runSteps(_ label: String, _ list: [Step], note: @escaping () -> String, done: @escaping () -> Void) {
    var steps = list
    func next() {
        if steps.isEmpty { done(); return }
        let (name, run, ok) = steps.removeFirst()
        run { print("\(label) \(name): \(ok() ? "ok" : "FAILED") | note '\(note())'"); fflush(stdout); next() }
    }
    next()
}
main.start()
if let prefix = selftest {
    DispatchQueue.main.asyncAfter(deadline: .now() + selftestWait) {
        main.open()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            fitCheck("STATUS")
            render(PanelView(model: main.model, prefs: Prefs(), nav: Nav(), book: RuleBook(), still: true), "\(prefix)-panel-dark.png")
            render(PanelView(model: main.model, prefs: Prefs(), nav: Nav(), book: RuleBook(), still: true), "\(prefix)-panel-light.png", dark: false)
            // every species: the eight running frames and one at rest, white on the dark bar
            let n = GAL.count + 1, k: CGFloat = 4, rows = SPECIES.count
            let RW = runner(SPECIES[0], frame: 0, idle: true).size.width, RH = runner(SPECIES[0], frame: 0, idle: true).size.height
            let sheet = NSImage(size: NSSize(width: RW * k * CGFloat(n), height: RH * k * CGFloat(rows)), flipped: false) { _ in
                NSColor(white: 0.14, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: RW * k * CGFloat(n), height: RH * k * CGFloat(rows)).fill()
                for (row, sp) in SPECIES.enumerated() {
                    for i in 0..<n {
                        let im = runner(sp, frame: i % GAL.count, idle: i == GAL.count)
                        let tinted = NSImage(size: im.size, flipped: false) { r in im.draw(in: r); NSColor.white.set(); r.fill(using: .sourceAtop); return true }
                        tinted.draw(in: NSRect(x: CGFloat(i) * RW * k, y: CGFloat(rows - 1 - row) * RH * k, width: RW * k, height: RH * k))
                    }
                }
                return true
            }
            print("RUNNER species \(SPECIES.count) | drawn now: \(runnerSpecies(main.model.snap?.animal?.grade).id) (grade \(main.model.snap?.animal?.grade ?? "none"))")
            png(sheet, "\(prefix)-runner.png")
            liveShot(main.hosting, "\(prefix)-panel-live.png")
            if let b = main.item.button { liveShot(b, "\(prefix)-item-live.png", forceDark: true) }  // the menu bar item itself, warning mark included
            let s = main.model.snap
            print("TITLE '\(main.item.button?.attributedTitle.string ?? "")' | warnings \(s?.warnings?.map { $0.chip } ?? []) | standing \(s?.standing.map { "\($0.name) \(Int($0.rank ?? 0))/\(Int($0.ranked ?? 0))" } ?? "none") | codex rows \(s?.sessions.filter { $0.agent == "codex" }.count ?? 0) | sysCpu \(main.model.sysCpu.map { pct1($0 * 100) } ?? "nil")"); fflush(stdout)
            settingsTest(prefix)
        }
    }
}
/** Open the settings page, check the window still fits, capture it, and with --selftest-write change each setting through the CLI. */
func settingsTest(_ prefix: String) {
    let p = main.prefs
    func state() -> String {
        guard let s = p.s else { return "settings not loaded" }
        let cw = s.compactWindow.map { "\($0.value.map { String(Int($0)) } ?? "unset") warn=\($0.warn) 1m=\($0.is1m)" } ?? "none"
        return "routing=\(s.routing.enabled ? "on" : "off") relaxed=\(s.routing.relaxed) compact=\(s.statusline.compact) labels=\(s.statusline.labels) timer=\(s.statusline.timer) lang=\(s.language) joined=\(s.team.joined) compactWindow=\(cw) samples=\(p.samples.count)"
    }
    main.nav.page = .settings
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
        print("SETTINGS \(state())"); fitCheck("SETTINGS")
        render(SettingsView(prefs: p, still: true), "\(prefix)-settings-dark.png")
        liveShot(main.hosting, "\(prefix)-settings-live.png")
        fflush(stdout)
        guard selftestWrite else { rulesTest(prefix); return }
        guard SANDBOX else { print("WRITE refused: not a sandbox"); fflush(stdout); rulesTest(prefix); return }
        let steps: [Step] = [
            ("routing off", { p.setRouting(false, then: $0) }, { p.s?.routing.enabled == false }),
            ("compact=2", { p.setLevel(2, then: $0) }, { p.s?.statusline.compact == 2 }),
            ("compact=3", { p.setLevel(3, then: $0) }, { p.s?.statusline.compact == 3 }),
            ("compact=1", { p.setLevel(1, then: $0) }, { p.s?.statusline.compact == 1 }),
            ("labels text", { p.setLabels("text", then: $0) }, { p.s?.statusline.labels == "text" }),
            ("labels narrow", { p.setLabels("narrow", then: $0) }, { p.s?.statusline.labels == "narrow" }),
            ("timer off", { p.setTimer(false, then: $0) }, { p.s?.statusline.timer == false }),
            ("lang en", { p.setLanguage("en", then: $0) }, { p.s?.language == "en" }),
            ("routing on", { p.setRouting(true, then: $0) }, { p.s?.routing.enabled == true }),
            ("relax on", { p.setRelax(true, then: $0) }, { p.s?.routing.relaxed == true && p.s?.routing.relaxUntil != nil }),
            ("relax off", { p.setRelax(false, then: $0) }, { p.s?.routing.relaxed == false }),
            ("compact window 500k", { p.setCompact(500_000, then: $0) }, { p.s?.compactWindow?.value == 500_000 }),
            ("compact window 600k", { p.setCompact(600_000, then: $0) }, { p.s?.compactWindow?.value == 600_000 }),
            ("compact warn off", { p.setCompactWarn(false, then: $0) }, { p.s?.compactWindow?.warn == false }),
            ("compact warn on", { p.setCompactWarn(true, then: $0) }, { p.s?.compactWindow?.warn == true }),
        ]
        runSteps("WRITE", steps, note: { p.note }) { print("SETTINGS \(state())"); fflush(stdout); rulesTest(prefix) }
    }
}
/** Open the rules page, capture it, and in a sandbox add and remove a rule in each source that has commands for it. */
func rulesTest(_ prefix: String) {
    let b = main.book
    func state() -> String {
        guard let d = b.data else { return "not loaded: \(b.note)" }
        return "global \(d.global.rules.count) (\(d.global.tokens) tokens, budget \(d.budgetTokens)) | projects \(d.projects.map { String($0.rules.count) }.joined(separator: ",")) | preset \(d.preset.rules.count) pending \(d.preset.pending.count) | model \(d.model.rules.count) enabled \(d.model.enabled) | team \(d.team.rules.count) joined \(d.team.joined)"
    }
    main.nav.page = .rules
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
        print("RULES \(state())")
        b.open = ["global", "preset"]
        if let first = b.data?.global.rules.first { b.expanded = "global#\(first.index)" }
        RELAYOUT()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            fitCheck("RULES")
            render(RulesView(book: b, still: true), "\(prefix)-rules-dark.png")
            liveShot(main.hosting, "\(prefix)-rules-live.png")
            fflush(stdout)
            guard selftestWrite, SANDBOX else { warningTest(prefix); return }
            let text = "셀프테스트 조건이면 셀프테스트 행동을 합니다"
            let count = { b.data?.global.rules.count ?? -1 }
            let n0 = count(), m0 = b.data?.model.rules.count ?? 0
            let pending = b.data?.preset.pending.first?.id ?? ""
            var steps: [Step] = [
                ("add global rule", { b.addRatchet(scope: "global", root: nil, key: "global", text: text, then: $0) }, { count() == n0 + 1 && (b.data?.global.rules.last?.text.contains(text) ?? false) }),
                ("refuse a removal whose text no longer matches", { b.removeRatchet(scope: "global", root: nil, index: n0 + 1, text: "다른 문장", then: $0) }, { count() == n0 + 1 && b.failed }),
                ("remove global rule", { b.removeRatchet(scope: "global", root: nil, index: n0 + 1, text: b.data?.global.rules.last?.text ?? "", then: $0) }, { count() == n0 && !b.failed }),
            ]
            if let pr = b.data?.projects.first {
                let key = "project:\(pr.root)"
                let pc = { b.data?.projects.first { $0.root == pr.root }?.rules.count ?? -1 }
                let p0 = pc()
                steps.append(("add project rule", { b.addRatchet(scope: "project", root: pr.root, key: key, text: text, then: $0) }, { pc() == p0 + 1 && count() == n0 }))
                steps.append(("remove project rule", { b.removeRatchet(scope: "project", root: pr.root, index: p0 + 1, text: b.data?.projects.first { $0.root == pr.root }?.rules.last?.text ?? "", then: $0) }, { pc() == p0 && !b.failed }))
            }
            if !pending.isEmpty {
                steps.append(("accept preset", { b.acceptPreset(pending, then: $0) }, { b.data?.preset.rules.contains { $0.id == pending } == true }))
                steps.append(("drop preset", { b.skipPreset(pending, then: $0) }, { b.data?.preset.rules.contains { $0.id == pending } == false && b.data?.preset.pending.contains { $0.id == pending } == false }))
            }
            if m0 > 0, let r = b.data?.model.rules.first {
                steps.append(("remove model rule", { b.removeModel(index: r.index, text: r.text, then: $0) }, { b.data?.model.rules.count == m0 - 1 && !b.failed }))
            }
            runSteps("RULE", steps, note: { b.note }) { print("RULES \(state())"); fflush(stdout); warningTest(prefix) }
        }
    }
}
/** Open the detail page of the first active warning and capture it. */
func warningTest(_ prefix: String) {
    guard let w = main.model.snap?.warnings?.first else { print("WARNING none active"); fflush(stdout); sessionTest(prefix); return }
    main.nav.page = .warning(w.chip)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        print("WARNING '\(w.chip)' level \(w.level) advice \(w.advice?.count ?? 0) actions \(w.advice?.first?.actions?.count ?? 0) detail \(w.detail != nil) | all \(main.model.snap?.warnings?.map { $0.chip } ?? [])")
        fitCheck("WARNING")
        render(WarningView(w: w, now: main.model.snap?.at ?? 0, still: true), "\(prefix)-warning-dark.png")
        liveShot(main.hosting, "\(prefix)-warning-live.png")
        fflush(stdout); sessionTest(prefix)
    }
}
/** Open the first session's page, then the dashboard window, and capture both. Counts only: the texts are the user's own prompts. */
func sessionTest(_ prefix: String) {
    let m = main.model
    func shape(_ s: Session?) -> String {
        guard let s = s else { return "none" }
        guard let d = s.detail else { return "effort \(s.effort ?? "nil") | no detail (detailOff \(m.detailOff))" }
        return "effort \(s.effort ?? "nil") | prompt \(d.prompt != nil) reply \(d.reply != nil) recent \(d.recent?.count ?? 0) pending \(d.recent?.filter { $0.pending == true }.count ?? 0) procs \(d.procs?.count ?? 0)"
    }
    guard let first = m.snap?.sessions.first else { print("SESSION none running"); fflush(stdout); dashboardTest(prefix); return }
    main.nav.page = .session(first.pid)
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) {
        let s = m.snap?.sessions.first { $0.pid == first.pid }
        print("SESSION \(shape(s)) | asked for detail \(m.wantDetail)")
        fitCheck("SESSION")
        render(SessionView(s: s, cpu: s.map { m.cpuOf($0) } ?? 0, mem: s.map { m.memOf($0) } ?? 0, now: m.snap?.at ?? 0, off: m.detailOff, still: true), "\(prefix)-session-dark.png")
        liveShot(main.hosting, "\(prefix)-session-live.png")
        fflush(stdout); dashboardTest(prefix)
    }
}
/**
 * Put the real window through its three sizes, as a press on the title bar would: after each one the layout the width picks
 * and the control have to agree with the size asked for, the frame has to be on the screen, and the content is captured.
 * Then the pin: the window must float after one press, and goes back to normal after the second.
 */
func dashSizeTest(_ prefix: String, done: @escaping () -> Void) {
    var todo = DashSize.allCases
    func next() {
        guard !todo.isEmpty else {
            main.toggleDashPin(); print("DASHPIN floating after toggle: \(main.dash?.level == .floating)"); main.toggleDashPin()
            fflush(stdout); done(); return
        }
        let s = todo.removeFirst()
        main.setDashSize(s, animate: false)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            if let w = main.dash, let v = w.contentView {
                let vis = (w.screen ?? NSScreen.main)?.visibleFrame ?? .zero
                print("DASHSIZE \(s.rawValue) window \(Int(w.frame.width))x\(Int(w.frame.height)) | layout \(DashSize.of(v.bounds.width).rawValue) | control \(main.dashUI.size.rawValue) | inside screen \(vis.contains(w.frame))")
                liveShot(v, "\(prefix)-dashboard-live-\(s.rawValue).png")
            }
            next()
        }
    }
    next()
}
func dashboardTest(_ prefix: String) {
    main.showDashboard()
    DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
        let m = main.model
        print("DASHBOARD window \(main.dash.map { "\(Int($0.frame.width))x\(Int($0.frame.height)) visible \($0.isVisible)" } ?? "none") | panel closed \(!main.isOpen) | asked for detail \(m.wantDetail) | sessions \(m.snap?.sessions.count ?? 0) with detail \(m.snap?.sessions.filter { $0.detail != nil }.count ?? 0)")
        if let icon = NSApp.applicationIconImage { png(icon, "\(prefix)-dock.png") }
        print("DOCK icon drawn for grade \(main.dockGrade ?? "none") (species \(runnerSpecies(main.dockGrade).id))")
        print("DOCK regular app while the dashboard is open: \(NSApp.activationPolicy() == .regular) | icon set \(NSApp.applicationIconImage != nil) | menu \(NSApp.mainMenu != nil) | reopen handler \(NSApp.delegate is App)")
        print("STARTED BY " + (m.parentSession.isEmpty ? "none" : m.parentSession.map { c, up in "\(m.snap?.sessions.first { $0.pid == c }?.label ?? "\(c)") <- \(m.snap?.sessions.first { $0.pid == up }?.label ?? "\(up)")" }.sorted().joined(separator: " | ")))
        print("PHASE " + (m.snap?.sessions ?? []).map { s in "\(s.label) \(m.phase(s)) [" + m.working(s, max: 3).map { "\($0.name) cpu \(pct1($0.w.cpu * 100)) gpu \(pct1($0.w.gpu * 100)) \(memText($0.w.mem))" }.joined(separator: "; ") + "]" }.joined(separator: " | "))
        render(DashboardView(model: m, still: true).frame(width: 1480), "\(prefix)-dashboard-dark.png")
        render(DashboardView(model: m, still: true, width: 340).frame(width: 340), "\(prefix)-dashboard-mini-dark.png")
        render(DashboardView(model: m, still: true, width: 780).frame(width: 780), "\(prefix)-dashboard-medium-dark.png")
        if let first = m.snap?.sessions.first { render(DashboardView(model: m, still: true, preselect: first.pid, width: 780).frame(width: 780), "\(prefix)-dashboard-medium-open-dark.png") }
        render(DashboardView(model: m, still: true, detail: true).frame(width: 1480), "\(prefix)-dashboard-detail-dark.png")
        render(DashboardView(model: m, still: true).frame(width: 1480), "\(prefix)-dashboard-light.png", dark: false)
        if let first = m.snap?.sessions.first { render(DashboardView(model: m, still: true, lit: first.pid).frame(width: 1480), "\(prefix)-dashboard-hover-dark.png") }
        print("GPU device \(m.gpu.map { pct1($0 * 100) } ?? "-") | processes on it \(m.gpuUse.count) | sessions on it \(m.gpuBySession.count) | top " + m.gpuUse.prefix(4).map { "\($0.name) \(pct1($0.share * 100)) \($0.session.map { "session \($0)" } ?? "no session")" }.joined(separator: "; "))
        let tree = m.usage.values.reduce(Load()) { var l = $0; l.cpu += $1.tree.cpu; l.mem += $1.tree.mem; l.n += $1.tree.n; return l }
        let det = m.usage.values.reduce(Load()) { var l = $0; l.cpu += $1.detached.cpu; l.mem += $1.detached.mem; l.n += $1.detached.n; return l }
        let oth = m.others.reduce(Load()) { var l = $0; l.cpu += $1.cpu; l.mem += $1.mem; l.n += $1.n; return l }
        print("CENSUS machine CPU \(pct1((m.sysCpu ?? 0) * 100)) mem \(memText(m.sysMemMb)) | session trees \(pct1(tree.cpu * 100)) \(memText(tree.mem)) (\(tree.n)) | detached \(pct1(det.cpu * 100)) \(memText(det.mem)) (\(det.n)) | left by ended sessions \(pct1(m.leftover.cpu * 100)) \(memText(m.leftover.mem)) (\(m.leftover.n)) | other programs \(pct1(oth.cpu * 100)) \(memText(oth.mem)) (\(oth.n))")
        print("CENSUS CLI figures for the same sessions: CPU \(pct1((m.snap?.sessions ?? []).reduce(0) { $0 + Model.raw($1) })) mem \(memText((m.snap?.sessions ?? []).reduce(0) { $0 + ($1.rssMb ?? 0) })) | leftover kinds \(m.leftoverItems.count) | other apps \(m.others.count)")
        print("CPUOF " + (m.snap?.sessions ?? []).map { "\($0.label) \(pct1(m.cpuOf($0))) \(memText(m.memOf($0)))" }.joined(separator: " | "))
        print("JUMP " + (m.snap?.sessions ?? []).map { "\($0.label) opens \(owningApp($0.pid)?.localizedName ?? "nothing found")\(exactTab($0) == nil ? ", app only" : ", its own tab")" }.joined(separator: " | ") + " | responsible-process lookup \(RESPONSIBLE == nil ? "missing" : "present")")
        print("LEFT " + m.leftoverItems.prefix(6).map { "\($0.name) x\($0.n) \(memText($0.mem))" }.joined(separator: " | "))
        print("OTHER " + m.others.sorted { $0.cpu > $1.cpu }.prefix(5).map { "\($0.name) \(pct1($0.cpu * 100)) \(memText($0.mem))" }.joined(separator: " | "))
        print("GROUPS " + groupSessions(m.snap?.sessions ?? [], parents: m.parentSession).map { "\($0.name) x\($0.sessions.count)" }.joined(separator: " | ") + " | started by another session \(m.parentSession.count)")
        if let first = m.snap?.sessions.first { render(DashboardView(model: m, still: true, preselect: first.pid).frame(width: 1480), "\(prefix)-dashboard-open-dark.png") }
        render(DashboardView(model: m, still: true, cleaning: true).frame(width: 1480), "\(prefix)-dashboard-clean-dark.png")
        print("DASHBOARD history samples \(m.samples.count) per-session \(m.hist.values.map { $0.count }.sorted())")
        if let v = main.dash?.contentView { liveShot(v, "\(prefix)-dashboard-live.png") }
        dashSizeTest(prefix) {
            print("LEFTOVER lines \(m.leftoverItems.count) | never cleaned (apps, virtual machines, databases): \(m.leftoverItems.filter { m.leftoverShared.contains($0.id) }.map { $0.name }.joined(separator: ", "))")
            // which session each line would reopen, and the folder that session worked in (the id itself is not printed)
            print("LEFTOVER sessions " + m.leftoverItems.map { it in "\(it.name)=" + (m.leftoverSession[it.id].map { sessionCwd($0).map { ($0 as NSString).lastPathComponent } ?? "no transcript" } ?? "none") }.joined(separator: ", "))
            if let target = selftestClean {
                let hit = m.leftoverItems.first { $0.name == target }
                print("CLEAN target '\(target)': \(hit.map { "\($0.n) process(es)" } ?? "not listed") | protected \(m.leftoverShared.contains(target))")
                print("CLEAN signals sent: \(m.stopLeftovers([target]))")
            }
            main.dash?.close()
            DispatchQueue.main.asyncAfter(deadline: .now() + (selftestClean == nil ? 0.6 : 6.0)) {
                if let target = selftestClean { print("CLEAN afterwards: '\(target)' \(m.leftoverItems.contains { $0.name == target } ? "still listed" : "gone") | leftover lines \(m.leftoverItems.count)") }
                print("DASHBOARD closed, asked for detail \(m.wantDetail) | back to a menu bar app \(NSApp.activationPolicy() == .accessory)"); fflush(stdout); NSApp.terminate(nil)
            }
        }
    }
}
if ttl > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + ttl) { NSApp.terminate(nil) } }
// One copy per user. sprag may try to start the app from several sessions at once; the lock decides, and the pid file tells
// `sprag bar off` and the next upgrade which process to stop.
var lockFd: Int32 = -1
if let dir = dataDir, selftest == nil {
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    lockFd = open(dir + "/bar-app.lock", O_CREAT | O_RDWR, 0o600)
    // After an upgrade sprag stops the old copy and starts this one straight away, so the lock may be held for a moment more.
    var mine = false
    if lockFd >= 0 { for _ in 0..<12 { if flock(lockFd, LOCK_EX | LOCK_NB) == 0 { mine = true; break }; usleep(250_000) } }
    if !mine { exit(0) }
    let info: [String: Any] = ["pid": Int(getpid()), "version": versionTag, "startedAt": Int(Date().timeIntervalSince1970 * 1000)]
    if let d = try? JSONSerialization.data(withJSONObject: info) { FileManager.default.createFile(atPath: dir + "/bar-app.json", contents: d, attributes: [.posixPermissions: 0o600]) }
}
ProcessInfo.processInfo.processName = "Sprag Bar"
print("READY"); fflush(stdout)
app.run()
