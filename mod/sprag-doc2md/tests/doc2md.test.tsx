import { expect, test } from 'claude-code/testing'

const DECK = '/work/deck.pptx'
const CACHE = '/cache/doc2md/deck-1a2b.md'

// What `sprag doc2md <path>` answers, as $.process.run resolves it
const cli = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

// Records each $.ui.status the mod sets; undefined is the line being cleared
const statusLine = (on: any) => {
  const seen: Array<string | undefined> = []
  on('ui.status', ($: unknown, e: { text: string | undefined }) => {
    seen.push(e.text)
    return { value: undefined }
  })
  return seen
}

test('a Read of a document reads the converted Markdown instead', async ($, on) => {
  const status = statusLine(on)
  const ran: string[][] = []
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    return cli(0, `✓ cached: ${CACHE}\n  1234 bytes\n`)
  })
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  const reads: Array<{ file_path?: string; pages?: string }> = []
  on('tool.call', ($, e) => {
    reads.push(e as { file_path?: string; pages?: string })
    return { result: 'read' }
  })

  await $.tool.call({ tool: 'Read', file_path: DECK, pages: '1-3' })

  expect(ran).toEqual([['sprag', 'doc2md', DECK]])
  expect(reads.length).toBe(1)
  expect(reads[0].file_path).toBe(CACHE)
  expect(reads[0].pages).toBeUndefined()
  expect(logs).toEqual(['doc2md: deck.pptx 대신 변환본을 읽습니다 (캐시)'])
  // The status names the file while the CLI runs and is cleared after it
  expect(status).toEqual(['doc2md: deck.pptx 변환 중…', undefined])
})

test('a Read of any other file runs no conversion', async ($, on) => {
  let ran = false
  on('process.run', () => {
    ran = true
    return { deny: 'not expected' }
  })
  const reads: Array<{ file_path?: string }> = []
  on('tool.call', ($, e) => {
    reads.push(e as { file_path?: string })
    return { result: 'read' }
  })

  await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })

  expect(ran).toBe(false)
  expect(reads[0].file_path).toBe('/work/README.md')
})

test('a refused conversion leaves the Read to the settings hook', async ($, on) => {
  const status = statusLine(on)
  on('process.run', () => cli(1, '', '✗ sensitive\n'))
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  const reads: Array<{ file_path?: string }> = []
  on('tool.call', ($, e) => {
    reads.push(e as { file_path?: string })
    return { result: 'read' }
  })

  await $.tool.call({ tool: 'Read', file_path: DECK })

  expect(reads[0].file_path).toBe(DECK)
  expect(logs).toEqual([])
  expect(status.at(-1)).toBeUndefined()
})

test('sprag missing from PATH leaves the Read untouched', async ($, on) => {
  const status = statusLine(on)
  // A program that cannot start rejects $.process.run
  on('process.run', () => ({ deny: 'spawn sprag ENOENT' }))
  const reads: Array<{ file_path?: string }> = []
  on('tool.call', ($, e) => {
    reads.push(e as { file_path?: string })
    return { result: 'read' }
  })

  await $.tool.call({ tool: 'Read', file_path: DECK })

  expect(reads[0].file_path).toBe(DECK)
  // A CLI that never started still clears the line
  expect(status).toEqual(['doc2md: deck.pptx 변환 중…', undefined])
})

test('an @-mentioned document attaches the converted Markdown', async ($, on) => {
  const status = statusLine(on)
  on('process.run', () => cli(0, `✓ converted: ${CACHE}\n`))
  on('ui.log', () => ({ value: undefined }))
  const attached: string[] = []
  on('prompt.mention', ($, e) => {
    attached.push(e.path)
    return { type: null }
  })

  await $.prompt.mention({ mention: 'deck.pptx', path: DECK })

  expect(attached).toEqual([CACHE])
  expect(status.at(-1)).toBeUndefined()
})
