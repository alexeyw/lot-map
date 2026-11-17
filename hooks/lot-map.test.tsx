import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Board } from '../types'
import type { Entry } from '../types'
import { paintBraille, rowsOf } from './braille'
import { COLOR_NAMES, STATIONS, TRAIL_FADE_MS, TRAIL_HOLD_MS, classify, clean, describeNow, drawMap, firstLine, foldRows, formatMs, keepNewest, memoryIds, nowParts, routeOf, setupFrom, shortModel, taskNotice, taskOf } from './map'
import { hasGlyph } from './raster'
import { stringsFor } from './text'

const PANE = {
  plugin: 'lot-map',
  component: 'Pane',
  requestId: 'lot-map',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Someone's own setup as it stands in settings: Russian labels and a memory of their own.
const OWN = {
  language: 'ru',
  coreName: 'ДОМ',
  memoryServers: ['recall'],
  memoryCommands: ['recall', 'check_recall'],
  memorySubcommands: ['add', 'memory'],
  memoryPaths: ['/.recall/'],
  memoryLabels: ['search=поиск', 'get_note=чтение записи'],
  hookRecords: true,
} as const
const SETUP = setupFrom(OWN)
const STRANGER = setupFrom({ language: 'en', coreName: 'CLAUDE', memoryServers: ['memory'], hookRecords: false })

test('every kind of call lands on its station', () => {
  const at = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).station
  expect(at('Bash', { command: 'recall memory journal --last 30' })).toBe('memory')
  expect(at('Bash', { command: 'python3 ~/.claude/scripts/recall-sync.py --apply' })).toBe('memory')
  expect(at('Bash', { command: 'python3 scripts/check_recall.py' })).toBe('memory')
  expect(at('Bash', { command: 'D=/tmp; cat $D/a | grep x; echo done' })).toBe('files')
  expect(at('Bash', { command: 'cat ~/.claude/projects/-Users-a/memory/x.md' })).toBe('memory')
  expect(at('Bash', { command: 'cat ~/.recall/x.md' })).toBe('memory')
  expect(at('Bash', { command: 'git push origin main' })).toBe('web')
  expect(at('Bash', { command: 'gh pr list' })).toBe('web')
  expect(at('Bash', { command: 'git status' })).toBe('shell')
  expect(at('Bash', { command: 'python3 _src/build.py' })).toBe('shell')
  expect(at('Read', { file_path: '/a/b/c/content.py' })).toBe('files')
  expect(at('Grep', { pattern: 'x' })).toBe('files')
  expect(at('Glob', { pattern: 'x' })).toBe('files')
  expect(at('Edit', { file_path: '/Users/a/.claude/projects/p/memory/n.md' })).toBe('memory')
  expect(at('mcp__recall__search', { query: 'x' })).toBe('memory')
  expect(at('mcp__Claude_Browser__navigate', { url: 'https://a.b/c' })).toBe('browser')
  expect(at('WebFetch', { url: 'https://a.b/c' })).toBe('web')
  expect(at('Agent', { description: 'x' })).toBe('agents')
  expect(at('Skill', { skill: 'pdf' })).toBe('skills')
  expect(at('AskUserQuestion', {})).toBe('you')
})

test('a command behind a wrapper is read as the command it runs', () => {
  const at = (command: string) => classify('Bash', { command }, STRANGER).station
  for (const command of [
    'sudo curl https://x.y',
    'sudo -u deploy curl https://x.y',
    'cat urls | xargs curl',
    'cat urls | xargs -n 1 -P 4 curl -s',
    'env A=1 curl x',
    'timeout 5 curl x',
    'timeout -s KILL 5 curl x',
    'time curl x',
    'nohup wget x',
    'sudo env A=1 nice -n 5 curl x',
    'git -C dir push',
    'git -c http.proxy=p --git-dir=.git fetch',
    'python -m pip install x',
    'python3.12 -m pip install x',
    'uv pip install x',
    'uv add x',
    'pipx install x',
    'poetry install',
    'npx -y create-foo',
    'pnpm dlx foo',
    'docker compose pull',
    'docker --context prod compose -f a.yml pull',
    'go get x',
    'go mod download',
    'apt-get install x',
    'sudo apt install x',
    'find . -exec curl {} \;',
    'find . -name "*.url" -exec sudo curl {} +',
  ]) expect(`${at(command)} ${command}`).toBe(`web ${command}`)

  for (const command of [
    'sudo cat /etc/hosts',
    'find . -name "*.tmp" -exec rm {} \;',
    'find . -type f | xargs grep x',
    'rm -rf build',
    'rmdir build',
    'env A=1 ls',
  ]) expect(`${at(command)} ${command}`).toBe(`files ${command}`)

  for (const command of [
    'find . -exec make {} \;',
    'sudo make install',
    'command -v curl',
    'npx tsc',
    'git -C dir status',
    'python -m http.server',
    'docker compose up',
    'go build ./...',
    'xargs',
    'timeout 5',
  ]) expect(`${at(command)} ${command}`).toBe(`shell ${command}`)

  // The label is still the first word of the line, never one found further in.
  expect(classify('Bash', { command: 'sudo --preserve-env=HOME -u bob curl x' }, STRANGER).label).toBe('sudo')
  // A memory command behind a wrapper is the memory command.
  expect(classify('Bash', { command: 'timeout 30 recall memory journal' }, SETUP)).toEqual({ station: 'memory', label: 'memory' })
})

test('built-in tools land by what they are for, labelled by their name alone', () => {
  // Every input carries words of its own: none of them may reach the label.
  const content = { subject: 'private', description: 'private', prompt: 'private', plan: 'private', query: 'private', message: 'private', uri: 'private', server: 'private' }
  const seen = (tool: string) => {
    const { station, label } = classify(tool, content, STRANGER)
    return `${station} ${label}`
  }

  for (const tool of [
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet',
    'TodoWrite',
    'EnterPlanMode',
    'ExitPlanMode',
    'PushNotification',
    'ReportFindings',
    'SendUserMessage',
    'FetchInboxMessage',
    'SendFeedback',
    'ProposeGoal',
    'propose_skills',
    'WrapUp',
    'ShowOnboardingRolePicker',
    'OfferChromeSetup',
    'ReadWidgetContext',
    'EndConversation',
  ]) expect(seen(tool)).toBe(`you ${tool}`)

  for (const tool of [
    'CronCreate',
    'CronDelete',
    'CronList',
    'ScheduleWakeup',
    'RemoteTrigger',
    'ListAgents',
    'SubagentHandback',
    'SendFile',
    'Poll',
    'Yield',
    'ReadNotifications',
  ]) expect(seen(tool)).toBe(`agents ${tool}`)

  for (const tool of [
    'ListSkills',
    'SearchSkills',
    'SuggestSkills',
    'ListPlugins',
    'SearchPlugins',
    'SuggestPluginInstall',
    'ListConnectors',
    'SearchMcpRegistry',
    'SuggestConnectors',
    'WaitForMcpServers',
  ]) expect(seen(tool)).toBe(`skills ${tool}`)

  for (const tool of [
    'ArtifactComments',
    'ArtifactData',
    'SendToProject',
    'SendToProjectContext',
    'Projects',
    'ClaudeDesign',
    'DesignSync',
    'ShareOnboardingGuide',
    'PublishPlugin',
    'ListMcpResourcesTool',
    'ReadMcpResourceTool',
    'ReadMcpResourceDirTool',
  ]) expect(seen(tool)).toBe(`web ${tool}`)

  for (const tool of [
    'LSP',
  ]) expect(seen(tool)).toBe(`files ${tool}`)

  // They work with git, or run code: Shell, as before.
  for (const tool of [
    'EnterWorktree',
    'ExitWorktree',
    'REPL',
    'AppifactRepl',
  ]) expect(seen(tool)).toBe(`shell ${tool}`)
})

test("an MCP server's resources are memory when the server is a memory server, and never show the resource's address", () => {
  const seen = (tool: string, server: string, setup = STRANGER) => {
    const { station, label } = classify(tool, { server, uri: 'file:///Users/a/private.md' }, setup)
    return `${station} ${label}`
  }
  for (const tool of ['ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool']) {
    expect(seen(tool, 'memory')).toBe(`memory ${tool}`)
    expect(seen(tool, 'github')).toBe(`web ${tool}`)
    // A server named in the person's options counts as theirs.
    expect(seen(tool, 'recall', SETUP)).toBe(`memory ${tool}`)
  }
  // Listing every server's resources names none: the call is no memory call.
  expect(classify('ListMcpResourcesTool', {}, STRANGER).station).toBe('web')
})

test('an MCP name with doubled underscores reads with single spaces', () => {
  expect(classify('mcp__my__server__tool', {}, STRANGER).label).toBe('my: server tool')
})

test('the browser reached from a cloud session lands on Browser, with a label like the local one', () => {
  const seen = (tool: string, input: Record<string, unknown>) => classify(tool, input, STRANGER)
  expect(seen('mcp__remote-devices__Claude_Browser__navigate', { url: 'https://user:private@a.b/x?q=1' })).toEqual({ station: 'browser', label: 'a.b' })
  expect(seen('mcp__remote-devices__Claude_Browser__get_page_text', {})).toEqual({ station: 'browser', label: 'get page text' })
  expect(seen('mcp__remote-devices__Claude_Browser__computer', { action: 'type', text: 'private' })).toEqual({ station: 'browser', label: 'computer' })
  // Only the browser: the server's other tools stay where they were.
  expect(seen('mcp__remote-devices__computer_screenshot', {}).station).toBe('web')
})

test('out of the box, memory is only what every install has', () => {
  const at = (tool: string, input: Record<string, unknown>) => classify(tool, input, STRANGER).station
  expect(at('Read', { file_path: '/Users/a/.claude/projects/p/memory/n.md' })).toBe('memory')
  expect(at('Read', { file_path: '/Users/a/.recall/n.md' })).toBe('files')
  expect(at('mcp__memory__search_nodes', {})).toBe('memory')
  expect(at('mcp__recall__search', {})).toBe('web')
  expect(at('Bash', { command: 'recall memory journal' })).toBe('shell')
  expect(classify('mcp__memory__search_nodes', {}, STRANGER).label).toBe('search nodes')
})

test('serverStations puts a server on each station the person may name, and the row still reads server: tool', () => {
  const put = (station: string) => setupFrom({ serverStations: [`srv=${station}`] })
  for (const station of ['files', 'shell', 'web', 'browser', 'agents', 'skills', 'you']) {
    expect(classify('mcp__srv__list_things', { query: 'private' }, put(station))).toEqual({ station, label: 'srv: list things' })
  }
  // A string works as well as a list, and the other servers stay where they were.
  const two = setupFrom({ serverStations: 'srv=files, other = skills' })
  expect(classify('mcp__srv__read', {}, two).station).toBe('files')
  expect(classify('mcp__other__read', {}, two).station).toBe('skills')
  expect(classify('mcp__third__read', {}, two).station).toBe('web')
  // What the person sets wins over the mod's own route for a server it knows.
  expect(classify('mcp__Claude_Browser__navigate', { url: 'https://a.b/c' }, setupFrom({ serverStations: ['Claude_Browser=web'] }))).toEqual({ station: 'web', label: 'Claude_Browser: navigate' })
  // The server's resources follow it.
  expect(classify('ReadMcpResourceTool', { server: 'srv', uri: 'private://x' }, put('files'))).toEqual({ station: 'files', label: 'ReadMcpResourceTool' })
})

test('serverStations ignores an entry whose station is unknown, or is memory, the model or hooks', () => {
  const odd = setupFrom({ serverStations: ['a=nowhere', 'b=memory', 'c=model', 'd=hooks', 'e=', '=files', 'no-equals', 'f=files'] })
  expect([...odd.serverStations]).toEqual([['f', 'files']])
  expect(classify('mcp__a__x', {}, odd).station).toBe('web')
  expect(classify('mcp__b__x', {}, odd).station).toBe('web')
  expect(setupFrom({}).serverStations.size).toBe(0)
  expect(setupFrom({ serverStations: 7 }).serverStations.size).toBe(0)
})

test('a server named in memoryServers and in serverStations goes to Memory', () => {
  const both = setupFrom({ memoryServers: ['recall'], serverStations: ['recall=files'] })
  expect(classify('mcp__recall__search', {}, both)).toEqual({ station: 'memory', label: 'search' })
  expect(classify('ReadMcpResourceTool', { server: 'recall' }, both).station).toBe('memory')
})

test('labels never carry what was written or searched', () => {
  const label = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).label
  expect(label('Read', { file_path: '/a/b/c/content.py' })).toBe('c/content.py')
  expect(label('Bash', { command: 'recall add "private text" --category journal' })).toBe('add')
  expect(label('Bash', { command: 'recall memory journal --last 30' })).toBe('memory')
  expect(label('Bash', { command: 'recall add private words here' })).toBe('add')
  expect(label('Bash', { command: 'recall private words here' })).toBe('recall')
  expect(label('Bash', { command: 'recall "private text"' })).toBe('recall')
  expect(label('mcp__recall__search', { query: 'private' })).toBe('поиск')
  expect(label('mcp__recall__get_note', { id: 7 })).toBe('чтение записи #7')
  expect(label('WebFetch', { url: 'https://a.b/secret?x=1' })).toBe('a.b')
  expect(label('WebFetch', { url: 'https://user:private@a.b/x' })).toBe('a.b')
  expect(label('WebFetch', { url: 'a.b/reset?token=private' })).toBe('a.b')
  expect(label('WebFetch', { url: 'file:///Users/a/private.txt' })).toBe('file')
  expect(label('mcp__Claude_Browser__navigate', { url: 'https://user:private@a.b/x' })).toBe('a.b')
  expect(label('Grep', { pattern: 'private' })).toBe('Grep')
  expect(label('WebSearch', { query: 'private' })).toBe('поиск в сети')
})

test('a password never reaches a label, even with a slash, a question mark or a hash in it', () => {
  const label = (url: string) => classify('WebFetch', { url }, SETUP).label
  expect(label('https://user:pa/ss@host.com/x')).toBe('host.com')
  expect(label('https://user:pa?ss@host.com')).toBe('host.com')
  expect(label('https://user:p#w@host.com')).toBe('host.com')
  expect(label('https://u:p%40ss@h.com')).toBe('h.com')
  expect(label('postgres://admin:hunter2@db.internal:5432/prod')).toBe('db.internal:5432')
  // A number after the colon may be a port or a password: neither reading is shown.
  expect(label('https://user:12345/x@host.com')).toBe('https')
  expect(label('https://host.com:8080/x?mail=a@b.com')).toBe('https')
  expect(label('https://host.com/x?mail=a@b.com')).toBe('host.com')
  expect(label('https://[::1]:8080/x')).toBe('[::1]:8080')
  expect(label('https://[::1]/x?tok=@secret')).toBe('[::1]')
  expect(label('https://[::1]/x?mail=a@b.com')).toBe('[::1]')
  expect(label('https://[::1]:8080/x?mail=a@b.com')).toBe('[::1]:8080')
  expect(label('https://[u:pa/ss@host.com/x')).toBe('https')
  expect(label('https://пример.рф/x')).toBe('пример.рф')
  expect(label('https://bad host/x')).toBe('https')
})

test('a Windows path is read like any other: the last two parts, memory folders, command names', () => {
  const label = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).label
  const at = (tool: string, input: Record<string, unknown>, setup = SETUP) => classify(tool, input, setup).station
  expect(label('Read', { file_path: 'C:\\Users\\a\\private\\c\\content.py' })).toBe('c/content.py')
  expect(label('Edit', { file_path: 'C:\\Users\\a\\b/mixed\\n.md' })).toBe('mixed/n.md')
  expect(at('Read', { file_path: 'C:\\Users\\a\\.claude\\projects\\C--Users-a-p\\memory\\n.md' }, STRANGER)).toBe('memory')
  expect(at('Read', { file_path: 'C:\\Users\\a\\.recall\\n.md' })).toBe('memory')
  expect(at('Read', { file_path: 'C:\\Users\\a\\recall\\n.md' })).toBe('files')
  expect(at('Bash', { command: 'C:\\tools\\curl.exe -s https://a.b/list' })).toBe('web')
  expect(at('Bash', { command: 'C:\\Git\\cmd\\git.exe push origin main' })).toBe('web')
  expect(at('Bash', { command: 'C:\\tools\\grep.exe x C:\\Users\\a\\.recall\\n.md' })).toBe('memory')
  expect(label('Bash', { command: 'C:\\Users\\a\\private\\python.exe build.py' })).toBe('python')
  expect(label('Bash', { command: 'C:\\Users\\a\\private\\recall.exe add private words' })).toBe('add')
})

test('a memory command shows a word after it only when that word is a listed subcommand', () => {
  const label = (command: string) => classify('Bash', { command }, SETUP).label
  expect(label('recall add private words')).toBe('add')
  expect(label('recall hello world')).toBe('recall')
  expect(label('recall search private')).toBe('recall')
  expect(classify('mcp__recall__get_note', { id: 'note-7' }, SETUP).label).toBe('чтение записи #note-7')
  expect(classify('mcp__recall__get_note', { id: 'private words under id' }, SETUP).label).toBe('чтение записи')
})

test('a memory command is matched by its whole name, not by how any name starts', () => {
  const short = setupFrom({ memoryCommands: ['m', 'recall'] })
  const at = (command: string) => classify('Bash', { command }, short).station
  expect(at('mv a b')).toBe('files')
  expect(at('mkdir x')).toBe('files')
  expect(at('make all')).toBe('shell')
  expect(at('recallable --now')).toBe('shell')
  expect(at('m note')).toBe('memory')
  expect(at('recall-sync.py --apply')).toBe('memory')
  expect(at('python3 scripts/recall_check.py')).toBe('memory')
})

test('commands that reach the network light Network, also from inside another command', () => {
  const at = (command: string) => classify('Bash', { command }, SETUP).station
  expect(at('rsync -a a/ host:b/')).toBe('web')
  expect(at('nc -z host 80')).toBe('web')
  expect(at('npm install')).toBe('web')
  expect(at('npm test')).toBe('shell')
  expect(at('docker pull image')).toBe('web')
  expect(at('docker ps')).toBe('shell')
  expect(at('cat $(curl -s https://a.b/list)')).toBe('web')
  expect(at('cat `curl -s https://a.b/list`')).toBe('web')
  expect(at('cat "$(dirname x)/a"')).toBe('files')
})

test('a label loses what a terminal would act on', () => {
  expect(clean('a\u001b[31mred\u0007 b')).toBe('a [31mred b')
  expect(clean('line\nnext\ttab')).toBe('line next tab')
  expect(clean('x\u202egnp.exe')).toBe('x gnp.exe')
  expect(clean('я'.repeat(200)).length).toBe(120)
})

test('hook helpers', () => {
  expect(memoryIds('• [#1971 excerpt] and [now #45] and [todo #3] and [#1971 again]')).toEqual(['1971', '45', '3'])
  expect(firstLine('\nBlocked by x: rule.\nCommand: secret')).toBe('Blocked by x: rule.')
  expect(formatMs(1500, stringsFor('en'))).toBe('1.5 s')
  expect(formatMs(1500, stringsFor('ru'))).toBe('1.5 с')
  expect(formatMs(1500, stringsFor('de'))).toBe('1,5 s')
  expect(stringsFor('en').records(1, '#7')).toBe('1 record: #7')
  expect(stringsFor('en').stations.web).toBe('Network')
})

const LANGUAGES = ['en', 'ru', 'es', 'fr', 'de', 'it', 'pt'] as const

test('every language has every word, in a table of its own', () => {
  const en = stringsFor('en')
  for (const language of LANGUAGES) {
    const t = stringsFor(language)
    expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(t.stations).sort()).toEqual(Object.keys(en.stations).sort())
    expect(Object.values(t.stations).every(name => name !== '')).toBe(true)
  }
  expect(new Set(LANGUAGES.map(language => stringsFor(language).title)).size).toBe(LANGUAGES.length)
  expect(stringsFor('constructor').title).toBe(en.title)
})

test('the terminal picture\'s font has every letter the map writes, in every language', () => {
  const words = LANGUAGES.flatMap(language => Object.values(stringsFor(language).stations))
  const missing = [...new Set([...words.join(''), ...'0123456789%×↓→·…◆+ abcdefghijklmnopqrstuvwxyz.CLAUDE'])].filter(ch => !hasGlyph(ch))
  expect(missing).toEqual([])
})

test('the braille map has room for every station\'s name, whole and beside all it can carry, in every language', () => {
  // The most a name carries: a count, and the mark of what went wrong.
  const board: Board = { entries: [], counts: Object.fromEntries(STATIONS.map(s => [s.id, 888])), faults: Object.fromEntries(STATIONS.map(s => [s.id, 100])) }
  for (const language of LANGUAGES) {
    for (const layout of ['you-top', 'you-bottom'] as const) {
      const setup = setupFrom({ language, layout })
      // At its smallest and at its largest.
      for (const [columns, rows] of [[50, 17], [76, 21]] as const) {
        const grid = rowsOf(paintBraille(board, 1_000_000, setup, columns, rows)).join('\n')
        for (const name of Object.values(setup.t.stations)) expect(grid).toContain(`${name} 888 !99+`)
        // Every letter of the language is one a cell holds: none became a question mark.
        expect(grid).not.toContain('?')
      }
    }
  }
})

for (const [language, row] of [['es', 'Archivos  b/content.py'], ['fr', 'Fichiers   b/content.py'], ['de', 'Dateien    b/content.py'], ['it', 'File      b/content.py'], ['pt', 'Ficheiros b/content.py']] as const) {
  test(`the pane speaks ${language}, its columns even`, { options: { language } }, async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain(row)
    await ui.unmount()
  })
}

test('paneBackground is the theme\'s unless it is transparent or a colour', () => {
  expect(setupFrom({}).paneBackground).toBe('theme')
  expect(setupFrom({ paneBackground: 'transparent' }).paneBackground).toBe('transparent')
  expect(setupFrom({ paneBackground: ' Transparent ' }).paneBackground).toBe('transparent')
  expect(setupFrom({ paneBackground: '#0A0F1A' }).paneBackground).toBe('#0a0f1a')
  expect(setupFrom({ paneBackground: '#abc' }).paneBackground).toBe('#aabbcc')
  for (const odd of ['clear', 'red', '#12345', 'rgb(1,2,3)', '', 7, true]) expect(setupFrom({ paneBackground: odd }).paneBackground).toBe('theme')
})

test('options that make no sense count as not set', () => {
  const odd = setupFrom({ language: 'xx', coreName: '   ', memoryServers: 7, memoryLabels: ['no-equals', '=x', 'y='], hookRecords: 'yes' })
  expect(odd.t.idle).toBe(stringsFor('en').idle)
  expect(odd.core).toBe('CLAUDE')
  expect(odd.memoryServers.size).toBe(0)
  expect(odd.memoryLabels.size).toBe(0)
  expect(odd.hookRecords).toBe(false)
})

test('a long name shrinks inside the core and cannot break the drawing', () => {
  const svg = (name: string) => drawMap({ entries: [], counts: {} }, 1000, setupFrom({ coreName: name }))
  expect(svg('A<B&"C"DEFGHIJK')).toContain('A&lt;B&amp;&quot;C&quot;DEF<')
  expect(svg('ABC')).toContain('font-size="17" letter-spacing="2.5"')
  expect(svg('CLAUDE')).toContain('font-size="13.8"')
  expect(svg('')).toContain('>CLAUDE<')
})

test('the drawing stays within what Svg accepts at its fullest', () => {
  const now = 1_000_000
  const stations = ['you', 'model', 'memory', 'files', 'shell', 'web', 'browser', 'agents', 'skills', 'hooks'] as const
  const board: Board = {
    model: 'claude-opus-5-5',
    step: 12,
    counts: { files: 12345 },
    entries: Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      station: stations[i % stations.length] as (typeof stations)[number],
      label: 'x'.repeat(70),
      from: 'core' as const,
      startedAt: now - 100 - i,
      status: 'run' as const,
    })),
  }
  const svg = drawMap(board, now, SETUP)
  expect(svg.length).toBeLessThan(131072)
  expect(svg).toContain('<animateMotion')
  expect(svg).toContain('opus 5.5')
  expect(svg).not.toContain('xxxxx')
  expect(svg).not.toContain('NaN')
  // Attributes are well formed: none empty, none run into the next.
  expect(svg).not.toContain('=""')
  expect(/"[a-z-]+="/.test(svg)).toBe(false)
  expect(svg).toContain('font-family="SF Mono, ui-monospace, Menlo, monospace"')
  expect(svg).not.toContain('Infinity')
})

test('with no options set the map speaks English and shows no record numbers', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('tool.call', () => ({ result: {} }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#12 excerpt] text of a note'] }))

  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  await $.tool.call({ tool: 'Bash', command: 'recall add note', description: 'Save a note' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /[а-яё]/i })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /added context to the message/ }))?.text).toContain('Hooks')
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Files')
    expect((await ui.find({ type: 'Text', text: /Save a note/ }))?.text).toContain('Shell')
    expect(await ui.find({ type: 'Text', text: /#12/ })).toBeUndefined()
    await ui.unmount()
  }
})

// The pane's background as the engine is asked for it, by what `paneBackground` says.
async function openedWith(...[$, on]: Parameters<TestBody>): Promise<unknown[]> {
  const asked: unknown[] = []
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('ui.open', (_, e) => {
    asked.push('backgroundColor' in e ? e.backgroundColor : 'none')
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return asked
}

test('by default the pane is opened without a background of its own', async ($, on) => {
  expect(await openedWith($, on)).toEqual(['none'])
})

test('paneBackground transparent opens the pane transparent', { options: { paneBackground: 'transparent' } }, async ($, on) => {
  expect(await openedWith($, on)).toEqual(['transparent'])
})

test('paneBackground #rrggbb opens the pane in that colour', { options: { paneBackground: '#0A0F1A' } }, async ($, on) => {
  expect(await openedWith($, on)).toEqual(['#0a0f1a'])
})

test('an unknown paneBackground keeps the theme\'s', { options: { paneBackground: 'clear' } }, async ($, on) => {
  expect(await openedWith($, on)).toEqual(['none'])
})

test('a call shows on the pane, on every surface', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Файлы')
    await ui.unmount()
  }
})

test('a call a settings hook refused reads as blocked, with the hook lit and its words kept back', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.PreToolUse', () => ({ deny: 'JUDGE: found key sk-private\nCommand: secret' }))
  on('tool.call', () => ({ result: {} }))
  let kept: Board = { entries: [], counts: {} }
  on('state.set', ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept = e.value?.value ?? kept), next(e))) as never)

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })

  expect(kept.entries.filter(e => e.station === 'shell').map(e => e.status)).toEqual(['block'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /остановил Bash/ }))?.text).toContain('Хуки')
  expect((await ui.find({ type: 'Text', text: /Показать статус/ }))?.text).toContain('✕')
  expect(await ui.find({ type: 'Text', text: /JUDGE|sk-private|secret/ })).toBeUndefined()
  await ui.unmount()
})

test('what is remembered between two events is held to a count, the oldest dropped first', () => {
  // A refusal waits for its call, a subagent's name for its steps: either may never come, and neither may stay for good.
  const refused = new Set<string>()
  for (let i = 0; i < 100; i++) {
    refused.add(`call-${i}`)
    keepNewest(refused, 64)
  }
  expect(refused.size).toBe(64)
  expect(refused.has('call-35')).toBe(false)
  expect(refused.has('call-36')).toBe(true)
  expect(refused.has('call-99')).toBe(true)
  const crew = new Map([['a', 'one'], ['b', 'two'], ['c', 'three']])
  keepNewest(crew, 2)
  expect([...crew.keys()]).toEqual(['b', 'c'])
  // Under the count nothing goes.
  keepNewest(crew, 2)
  expect(crew.size).toBe(2)
})

test('with hookReasons on, the first line of a refusal shows and the rest does not', { options: { ...OWN, hookReasons: true } }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.PreToolUse', () => ({ deny: 'JUDGE: нельзя\nCommand: secret' }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /JUDGE/ }))?.text).toContain('Хуки')
  expect(await ui.find({ type: 'Text', text: /secret/ })).toBeUndefined()
  await ui.unmount()
})

test('an error of the tool itself is no refusal: the hooks station stays dark', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('tool.call', () => ({ result: {}, isError: true, text: 'Exit code 1\nls: /nowhere: No such file or directory' }))

  await $.tool.call({ tool: 'Bash', command: 'ls /nowhere', description: 'Показать папку' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /остановил Bash/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Показать папку/ }))?.text).toContain('✕')
  await ui.unmount()
})

test('memory a hook adds shows as numbers, never as its text', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#1971 excerpt] тайный текст записи\n• [#277 excerpt] ещё'] }))

  await $.classic.UserPromptSubmit({ prompt: 'привет', permission_mode: 'default' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /записей 2/ }))?.text).toContain('#1971 #277')
  expect(await ui.find({ type: 'Text', text: /тайный/ })).toBeUndefined()
  await ui.unmount()
})

test('a broken board never stops the tool', async ($, on) => {
  on('state.get', () => { throw new Error('no state') })
  on('state.set', () => { throw new Error('no state') })
  on('tool.call', () => ({ result: { ok: true } }))

  const ran = await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toEqual({ ok: true })
})

test('what an earlier version stored is declined', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('state.get', () => ({ value: { value: { rows: 1 }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Пока ничего/ }))?.text).toBe('Пока ничего не было.')
  await ui.unmount()
})

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as const

test('a model step streams through untouched and shows on the map', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'первый' } as never
    yield { kind: 'text', index: 0, text: 'второй' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })

  const seen: unknown[] = []
  const stream = $.turn.step(STEP)
  for await (const chunk of stream) seen.push(chunk)
  expect(seen).toEqual([{ kind: 'text', index: 0, text: 'первый' }, { kind: 'text', index: 0, text: 'второй' }])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /шаг 1/ })
  expect(row?.text).toContain('Модель')
  expect(row?.text).toContain('opus 5.5')
  await ui.unmount()
})

test('a broken board never stops a model step', async ($, on) => {
  on('state.get', () => { throw new Error('no state') })
  on('state.set', () => { throw new Error('no state') })
  on('clock.now', () => { throw new Error('no clock') })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'дошло' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })

  const seen: unknown[] = []
  for await (const chunk of $.turn.step(STEP)) seen.push(chunk)
  expect(seen).toEqual([{ kind: 'text', index: 0, text: 'дошло' }])
})

test('the end of a turn settles a call that never reported back', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'и всё' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })
  // A step that was never read to its end stays "running", as an interrupted call does.
  const hanging = $.turn.step(STEP)[Symbol.asyncIterator]()
  await hanging.next()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /ход прерван/ }))?.text).toContain('Ты')
  expect(await ui.find({ type: 'Text', text: /идёт/ })).toBeUndefined()
  await ui.unmount()
})

// ---- what the second version added ---------------------------------------------------------------

const entry = (station: Entry['station'], startedAt: number, more: Partial<Entry> = {}): Entry => ({
  id: `${station}${startedAt}`,
  station,
  label: station,
  from: 'core',
  startedAt,
  endedAt: startedAt + 10,
  status: 'ok',
  ...more,
})

test('the route is the main loop\'s stations in order, repeats and model steps left out', () => {
  const entries = [
    entry('you', 1, { from: 'inbound' }),
    entry('model', 2),
    entry('memory', 3),
    entry('memory', 4),
    entry('model', 5),
    entry('files', 6),
    entry('shell', 7, { from: 'agents', agentId: 'a1' }),
    entry('shell', 8),
  ]
  expect(routeOf(entries).map(stop => stop.station)).toEqual(['you', 'memory', 'files', 'shell'])
  expect(routeOf(entries)[1]?.at).toBe(4)
  expect(routeOf(entries, 2).map(stop => stop.station)).toEqual(['files', 'shell'])

  const svg = drawMap({ entries, counts: {} }, 5000, STRANGER)
  expect(svg.split('<path d="M').length - 1).toBe(3)
  expect(svg).toContain('stroke-dashoffset')
})

test('finished calls in a row at one station fold into one row, anything else stands alone', () => {
  const rows = foldRows([
    entry('files', 1),
    entry('files', 20),
    entry('files', 40),
    entry('shell', 60, { status: 'err' }),
    entry('shell', 80, { status: 'err' }),
    entry('model', 100, { mark: 'switch' }),
    entry('files', 120, { status: 'run', endedAt: undefined }),
    entry('files', 140),
  ])
  expect(rows.map(row => `${row.entry.station} ${row.times} ${row.tookMs}`)).toEqual([
    'files 1 10',
    'files 1 0',
    'model 1 10',
    'shell 1 10',
    'shell 1 10',
    'files 3 30',
  ])
  expect(foldRows(Array.from({ length: 40 }, (_, i) => entry(i % 2 ? 'files' : 'shell', i * 20))).length).toBe(16)
})

test('a spoke wears in with use and memory has a colour of its own', () => {
  const quiet = drawMap({ entries: [], counts: {} }, 1000, STRANGER)
  const busy = drawMap({ entries: [], counts: { files: 200, memory: 9 }, pushed: 4 }, 1000, STRANGER)
  expect(quiet).not.toContain('stroke-width="3.6"')
  expect(busy).toContain('stroke-width="3.6"')
  expect(busy).toContain('>5 <tspan fill="#62c7ba">↓4</tspan>')
  expect(drawMap({ entries: [], counts: { memory: 4 }, pushed: 4 }, 1000, STRANGER)).toContain('><tspan fill="#62c7ba">↓4</tspan>')
})

test('a long call shows two clock hands, several at once a count, a fault a dot until the next message', () => {
  const now = 1_000_000
  const running = (startedAt: number): Entry => entry('shell', startedAt, { status: 'run', endedAt: undefined })
  const one = drawMap({ entries: [running(now - 90_000)], counts: { shell: 1 } }, now, STRANGER)
  expect(one).toContain('begin="-30.000s" dur="60.000s" repeatCount="indefinite"')
  expect(one).toContain('begin="-90.000s" dur="600.000s" fill="freeze"')
  expect(one).not.toContain('×')
  const three = drawMap({ entries: [running(now - 300), running(now - 200), running(now - 100)], counts: { shell: 3 } }, now, STRANGER)
  expect(three).toContain('>×3<')
  expect(drawMap({ entries: [], counts: {}, faults: { shell: 2 } }, now, STRANGER)).toContain('font-weight="700" fill="#0a0c11">2<')
  expect(drawMap({ entries: [], counts: {} }, now, STRANGER)).not.toContain('font-weight="700"')
})

test('the context ring, the crew, the model change and the light theme are drawn only when there is something to show', () => {
  const now = 1_000_000
  const bare = drawMap({ entries: [], counts: {} }, now, STRANGER)
  expect(bare).not.toContain('pathLength="100"')
  expect(bare).not.toContain('animateTransform')
  expect(bare).toContain('#0a0c11')

  const full = drawMap({ entries: [], counts: {}, model: 'claude-fable-5-2', context: 92.4, agents: ['a', 'b'], switchedAt: now - 2000 }, now, STRANGER)
  expect(full).toContain('stroke="#e8654f" pathLength="100" stroke-dasharray="92 100"')
  expect(full).toContain('>92%<')
  expect(full.split('<animateTransform').length - 1).toBe(2)
  expect(full).toContain('repeatCount="4" fill="freeze"')
  expect(drawMap({ entries: [], counts: {}, switchedAt: now - 9000 }, now, STRANGER)).not.toContain('repeatCount="1" fill="freeze"')

  // Left to itself the map is drawn dark and carries the rules that repaint it on a light surface; a set theme carries none.
  expect(bare).toContain('<style>@media (prefers-color-scheme: light){[fill="#0a0c11"]{fill:#f5f2ea}')
  expect(bare).toContain('<rect width="460" height="430" rx="12" fill="#0a0c11"/>')
  const dark = drawMap({ entries: [], counts: {} }, now, setupFrom({ theme: 'dark' }))
  expect(dark).not.toContain('<style>')
  expect(dark).not.toContain('#f5f2ea')
  const light = drawMap({ entries: [], counts: {} }, now, setupFrom({ theme: 'light' }))
  expect(light).not.toContain('<style>')
  expect(light).toContain('<rect width="460" height="430" rx="12" fill="#f5f2ea"/>')
  // Whatever is lit, every color the dark drawing uses is one the rules know.
  const lit = drawMap(
    { entries: [entry('memory', now - 100, { from: 'inbound' }), entry('shell', now - 50, { status: 'err' }), entry('files', now - 20, { status: 'run', endedAt: undefined })], counts: { files: 50, memory: 3 }, pushed: 1, faults: { shell: 1 }, context: 80, agents: ['a'], switchedAt: now - 10, model: 'claude-fable-5-2' },
    now,
    setupFrom({ theme: 'dark' }),
  )
  const known = new Set(['#0a0c11', '#12151c', '#272c36', '#1a1e27', '#ebe6dc', '#9ba1ab', '#6b7280', '#e1ac6e', '#f0c595', '#e8654f', '#62c7ba', '#a5e6dc', '#ebe6dd'])
  expect([...new Set(lit.match(/#[0-9a-f]{6}/g) ?? [])].filter(color => !known.has(color))).toEqual([])
})

const stepOn = (model: string) => ({ turnId: 't1', index: 0, model, messageCount: 1 }) as const

test('a model that changes mid-session is a row of its own, and the first model of a session is not', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })
  for (const model of ['claude-opus-5-5', 'claude-opus-5-5', 'claude-fable-5-2']) {
    for await (const _ of $.turn.step(stepOn(model))) void _
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /→/ })
  expect(row?.text).toContain('◆ Модель')
  expect(row?.text).toContain('opus 5.5 → fable 5.2')
  expect((await ui.find({ type: 'Text', text: /\+1/ }))?.text).toContain('opus 5.5 · шаг 1')
  await ui.unmount()
})

test('a subagent circles the agents station until its loop ends, and its hanging call is settled then', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never
    return { turnId: 't2', index: 0, answer: '', toolUses: [] } as never
  })
  const hanging = $.turn.step({ ...stepOn('claude-haiku-5-5'), turnId: 't2', agentId: 'a1' } as never)[Symbol.asyncIterator]()
  await hanging.next()

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The row is running: its mark says so, and its time column holds the word, which the second mount below sees gone.
  expect(await ui.find({ type: 'Text', text: /^● .*субагент/ })).toBeDefined()
  expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('animateTransform')
  await ui.unmount()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' } as never)

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /идёт/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ответ готов/ })).toBeUndefined()
  expect((await ui.find({ type: 'Svg' }))?.props.source).not.toContain('animateTransform')
  await ui.unmount()
})

test('what goes wrong stays on its station until the next message; an interrupted turn is no fault', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: {}, isError: true }) as never)

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)

  const dots = async (): Promise<number> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const source = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()
    return source.split('font-weight="700"').length - 1
  }
  expect(await dots()).toBe(1)
  await $.turn.start({ text: 'дальше', turnId: 't2' } as never)
  expect(await dots()).toBe(0)
})

test('the context window shows as soon as the engine tells how full it is', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 37 } } }) as never)
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })
  for await (const _ of $.turn.step(stepOn('claude-opus-5-5'))) void _

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('>37%<')
  // Beside the drawing the line of now says only what runs: the drawing has the figure and the model already.
  const idle = await ui.find({ type: 'Text', text: /Ожидание/ })
  expect(idle?.text).toBe('Ожидание')
  // In the theme's text colour, not the terminal's default, which a light terminal makes black on a dark pane.
  expect(idle?.props.color).toBe('text')
  await ui.unmount()

  // A terminal has no drawing, so the figure and the model stand at the right of that line, apart from the words.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^37%/ }))?.text).toBe('37% · opus 5.5')
  await term.unmount()
})

test('the ring can be turned so that the person is at the bottom and the network at the top', () => {
  const heightOf = (svg: string, name: string): number => Number(new RegExp(`y="([\\d.]+)"[^>]*>${name}<`).exec(svg)?.[1])
  const board: Board = { entries: [], counts: {} }
  const usual = drawMap(board, 1000, setupFrom({ theme: 'dark' }))
  const turned = drawMap(board, 1000, setupFrom({ theme: 'dark', layout: 'you-bottom' }))
  expect(heightOf(usual, 'You')).toBeLessThan(heightOf(usual, 'Network'))
  expect(heightOf(turned, 'You')).toBe(heightOf(usual, 'Network'))
  expect(heightOf(turned, 'Network')).toBe(heightOf(usual, 'You'))
  expect(heightOf(turned, 'Browser')).toBe(heightOf(usual, 'Model'))
  // A turned map does not leak into the next one drawn, and nonsense counts as not set.
  expect(drawMap(board, 1000, setupFrom({ theme: 'dark' }))).toBe(usual)
  expect(drawMap(board, 1000, setupFrom({ theme: 'dark', layout: 'sideways' }))).toBe(usual)
})

test('the map paints its ground unless told to leave the surface showing', () => {
  const board = { entries: [], counts: {} } as never
  const ground = /<rect width="460" height="430" rx="12"/
  expect(drawMap(board, 0, SETUP)).toMatch(ground)
  expect(drawMap(board, 0, setupFrom({ ...OWN, background: 'clear' }))).toMatch(ground)
  const bare = drawMap(board, 0, setupFrom({ ...OWN, background: 'transparent' }))
  expect(bare).not.toMatch(ground)
  expect(bare).toContain('ДОМ')
  // The setting does not leak into the next drawing.
  expect(drawMap(board, 0, SETUP)).toMatch(ground)
})

test('a quoted path with a space is one command, and a Windows program is read whatever its capitals', () => {
  const at = (command: string) => classify('Bash', { command }, SETUP).station
  const label = (command: string) => classify('Bash', { command }, SETUP).label
  expect(at('"C:\\Program Files\\Git\\cmd\\git.exe" push origin main')).toBe('web')
  expect(label('"C:\\Program Files\\Git\\cmd\\git.exe" status')).toBe('git')
  expect(at("'/Applications/My Tools/bin/curl' -s https://a.b/x")).toBe('web')
  expect(at('C:\\tools\\CURL.EXE -s https://a.b/x')).toBe('web')
  expect(at('npm.cmd install')).toBe('web')
  expect(at('NPM.CMD test')).toBe('shell')
  // Without a Windows ending a name keeps its case: on other systems `Curl` is another program.
  expect(at('Curl -s https://a.b/x')).toBe('shell')
  // A quote left open does not swallow the line into nothing.
  expect(label('grep "unfinished x.txt')).toBe('grep')
  expect(at('cat "my notes.txt" | grep "two words"')).toBe('files')
})

test('the PowerShell tool is read like the shell: its description as the label, its commands by their own names', () => {
  const ps = (command: string, description = '') => classify('PowerShell', { command, description }, SETUP)
  expect(ps('Get-Content C:\\Users\\a\\private\\notes.txt', 'Read the notes').label).toBe('Read the notes')
  expect(ps('Get-Content C:\\Users\\a\\private\\notes.txt').label).toBe('Get-Content')
  expect(ps('Get-Content notes.txt | Select-String todo').station).toBe('files')
  expect(ps('get-childitem -Recurse | Where-Object { $_.Length -gt 1kb } | Sort-Object Length').station).toBe('files')
  expect(ps('$text = Get-Content notes.txt; Write-Host done').station).toBe('files')
  expect(ps('Get-Content C:\\Users\\a\\.recall\\n.md').station).toBe('memory')
  expect(ps('Invoke-WebRequest https://a.b/x -OutFile x.zip').station).toBe('web')
  expect(ps('IRM https://a.b/x').station).toBe('web')
  expect(ps('& "C:\\Program Files\\Git\\cmd\\git.exe" push origin main').station).toBe('web')
  expect(ps('git status').station).toBe('shell')
  expect(ps('Get-Process | Stop-Process').station).toBe('shell')
  expect(ps('recall add private words').label).toBe('add')
  expect(ps('Invoke-WebRequest https://user:private@a.b/secret?x=1').label).toBe('Invoke-WebRequest')
  // The same names mean nothing to the Bash tool.
  expect(classify('Bash', { command: 'Get-Content notes.txt' }, SETUP).station).toBe('shell')
})

test('the route is soft on a light surface and each leg fades by itself after a while', () => {
  const walk = [entry('you', 1000, { from: 'inbound' }), entry('memory', 2000), entry('files', 3000), entry('shell', 4000)]
  const legs = (svg: string) => svg.split('<path d="M').length - 1
  const fresh = 5000

  // Three legs, each carrying the animation that takes it away: it starts when the hold is over.
  const dark = drawMap({ entries: walk, counts: {} }, fresh, setupFrom({ theme: 'dark' }))
  expect(legs(dark)).toBe(3)
  expect(dark.split('attributeName="opacity" values="').length - 1).toBeGreaterThanOrEqual(3)
  expect(dark).toContain(`begin="${((TRAIL_HOLD_MS - (fresh - 4000)) / 1000).toFixed(3)}s" dur="${(TRAIL_FADE_MS / 1000).toFixed(3)}s"`)
  expect(dark).toContain('stroke="#ebe6dd"')

  // On a light surface the route is a grey of its own, not the ink of the words.
  const light = drawMap({ entries: walk, counts: {} }, fresh, setupFrom({ theme: 'light' }))
  expect(light).toContain('stroke="#9c978b"')
  expect(light).not.toMatch(/<path d="M[^>]*stroke="#1f2228"[^>]*stroke-linecap="round" opacity=/)
  // Left to itself the map repaints the route with the rest.
  expect(drawMap({ entries: walk, counts: {} }, fresh, STRANGER)).toContain('[stroke="#ebe6dd"]{stroke:#9c978b}')

  // A leg in the middle of its fading starts the animation in the past, so it is drawn part-way gone.
  // The two older legs are gone by then; the newest has a second left.
  const almost = 3000 + TRAIL_HOLD_MS + TRAIL_FADE_MS
  const fading = drawMap({ entries: walk, counts: {} }, almost, setupFrom({ theme: 'dark' }))
  expect(legs(fading)).toBe(1)
  expect(fading).toContain(`begin="${((TRAIL_HOLD_MS - (almost - 4000)) / 1000).toFixed(3)}s"`)

  // After the hold and the fade nothing of the route is left; the spokes still say where the work went.
  const later = drawMap({ entries: walk, counts: { shell: 1 } }, 4000 + TRAIL_HOLD_MS + TRAIL_FADE_MS, setupFrom({ theme: 'dark' }))
  expect(legs(later)).toBe(0)
  expect(later).not.toContain('stroke="#ebe6dd"')
})

test('colors of your own replace their places in the palette, and nothing but a hex color gets into the drawing', () => {
  const board = { entries: [entry('you', 1000, { from: 'inbound' }), entry('files', 2000), entry('shell', 3000)], counts: { files: 1, shell: 1 } }
  const draw = (options: Record<string, unknown>) => drawMap(board, 4000, setupFrom(options))

  const own = draw({ theme: 'dark', colors: ['accent=#FF9900', 'background = #123', 'route=#00ff88'] })
  expect(own).toContain('#ff9900')
  expect(own).not.toContain('#e1ac6e')
  expect(own).toContain('<rect width="460" height="430" rx="12" fill="#112233"/>')
  expect(own).toContain('stroke="#00ff88"')
  // The rest of the palette is as it was.
  expect(own).toContain('#ebe6dc')

  // Written as one line with commas, as `claude plugin configure` takes lists.
  expect(setupFrom({ colors: 'accent=#ff9900, text=#ffffff' }).colors).toEqual({ accent: '#ff9900', bone: '#ffffff' })

  // Anything that is not a hex color, and any unknown name, counts as not set.
  const hostile = ['accent="/><script>alert(1)</script>', 'accent=red', 'accent=#12345', 'accent=#1234567', 'accent=url(#x)', 'accent=#ff9900"', 'nonsense=#ffffff', '=#ffffff', 'accent', 'text=rgb(1,2,3)']
  expect(setupFrom({ colors: hostile }).colors).toEqual({})
  expect(draw({ theme: 'dark', colors: hostile })).toBe(draw({ theme: 'dark' }))
  expect(draw({ theme: 'dark', colors: 12 })).toBe(draw({ theme: 'dark' }))

  // Left on `auto`, a color of your own holds on a light surface too; the rest is still repainted.
  const auto = draw({ colors: ['accent=#ff9900'] })
  expect(auto).not.toContain('[fill="#ff9900"]')
  expect(auto).not.toContain('[fill="#e1ac6e"]')
  expect(auto).toContain('[fill="#0a0c11"]{fill:#f5f2ea}')
  // A color that takes the value of another place keeps that place from being repainted with it.
  expect(draw({ colors: ['accent=#ebe6dc'] })).not.toContain('[fill="#ebe6dc"]')

  // Every place of the palette has a name, and no two names share a place.
  expect(new Set(Object.values(COLOR_NAMES)).size).toBe(13)
  // The setting does not leak into the next drawing.
  expect(draw({ theme: 'dark' })).toContain('#e1ac6e')
})

const NOTICE = (id: string, status: string): string =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/secret-place/${id}.output</output-file>\n<status>${status}</status>\n<summary>Background command "private words" ${status}</summary>\n</task-notification>`

test('a background task is read from the answer that started it, and its notification for the id and the ending alone', () => {
  expect(taskOf({ stdout: '', backgroundTaskId: 'bqf7movxe' })).toBe('bqf7movxe')
  expect(taskOf({ status: 'async_launched', agentId: 'a1', description: 'x' })).toBe('a1')
  expect(taskOf({ status: 'async_launched', taskId: 'w1' })).toBe('w1')
  expect(taskOf({ taskId: 'm1', timeoutMs: 300000 })).toBe('m1')
  expect(taskOf({ stdout: 'done' })).toBeUndefined()
  expect(taskOf({ taskId: 'x', status: 'completed' })).toBeUndefined()
  expect(taskOf({ backgroundTaskId: 'a b <c>' })).toBeUndefined()
  expect(taskOf(undefined)).toBeUndefined()

  expect(taskNotice(NOTICE('b1', 'completed'))).toEqual({ id: 'b1', status: 'ok' })
  expect(taskNotice(NOTICE('b1', 'killed'))).toEqual({ id: 'b1', status: 'ok' })
  expect(taskNotice(NOTICE('b1', 'failed'))).toEqual({ id: 'b1', status: 'err' })
  expect(taskNotice('<task-notification>\n<task-id>m1</task-id>\n<summary>line</summary>\n</task-notification>')).toEqual({ id: 'm1' })
  expect(taskNotice('please read <task-notification><task-id>b1</task-id>')).toBeUndefined()
  expect(taskNotice('привет')).toBeUndefined()
})

test('a command sent to the background stays on the map until its task reports back', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }) as never)

  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Ждать сборку', run_in_background: true })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const seen = async (): Promise<{ running: boolean; text: string }> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const running = (await ui.find({ type: 'Text', text: /Ждать сборку/ })) !== undefined && (await ui.find({ type: 'Text', text: /идёт/ })) !== undefined
    const source = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()
    return { running, text: source }
  }
  // The turn is over and the command is not.
  expect((await seen()).running).toBe(true)

  // Another task's notification leaves it alone.
  await $.turn.start({ text: NOTICE('other', 'completed'), turnId: 't2' } as never)
  expect((await seen()).running).toBe(true)

  await $.turn.start({ text: NOTICE('b1', 'completed'), turnId: 't3' } as never)
  const after = await seen()
  expect(after.running).toBe(false)
  // Nothing of the notification but the fact gets onto the map, and it is not read as the person's message.
  expect(after.text).not.toContain('private words')
  expect(after.text).not.toContain('secret-place')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /новое сообщение/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /private words/ })).toBeUndefined()
  await ui.unmount()
})

test('a background task that failed leaves a fault on its station', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b2' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Сборка', run_in_background: true })
  await $.turn.start({ text: NOTICE('b2', 'failed'), turnId: 't2' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  await ui.unmount()
  expect(source.split('font-weight="700"').length - 1).toBe(1)
})

test('a typed slash command keeps a background task that is older than the rows kept, and its name is cleaned', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('skill.prompt', (_, e) => ({ text: e.text }) as never)
  let n = 0
  on('tool.call', () => ({ result: n++ === 0 ? { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b9' } : {} }) as never)

  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Ждать сборку', run_in_background: true })
  for (let i = 0; i < 90; i++) await $.tool.call({ tool: i % 2 === 0 ? 'Read' : 'Bash', file_path: `/a/b/${i}.py`, command: 'make', description: `шаг ${i}` })
  await $.skill.prompt({ skill: 'de\u001b[31mploy', text: '' } as never)

  const running = async (): Promise<boolean> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const found = (await ui.find({ type: 'Text', text: /Ждать сборку/ })) !== undefined
    await ui.unmount()
    return found
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /de \[31mploy/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\u001b/ })).toBeUndefined()
  await ui.unmount()
  expect(await running()).toBe(true)
  await $.turn.start({ text: NOTICE('b9', 'completed'), turnId: 't2' } as never)
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /идёт/ })).toBeUndefined()
  await after.unmount()
})

test('with reduced motion nothing flies, spreads or spins, and a call still shows', () => {
  const now = 1_000_000
  const board: Board = {
    entries: [
      { id: 'a', station: 'files', label: 'a.py', from: 'core', startedAt: now - 5000, endedAt: now - 4000, status: 'ok' },
      { id: 'b', station: 'shell', label: 'make', from: 'core', startedAt: now - 300, status: 'run' },
      { id: 'c', station: 'web', label: 'x.y', from: 'core', startedAt: now - 200, endedAt: now - 100, status: 'err' },
      { id: 'd', station: 'you', label: 'done', from: 'core', startedAt: now - 50, endedAt: now - 50, status: 'ok', mark: 'done' },
    ],
    counts: { files: 1, shell: 1, web: 1 },
    agents: ['x', 'y'],
    model: 'claude-opus-5-5',
    switchedAt: now - 500,
  }
  const full = drawMap(board, now, setupFrom())
  const still = drawMap(board, now, setupFrom({ motion: 'reduced' }))

  // The default is the drawing as it was.
  expect(full).toContain('<animateMotion')
  expect(full).toContain('<animateTransform')
  expect(full).toContain('attributeName="r"')

  expect(still).not.toContain('<animateMotion')
  expect(still).not.toContain('<animateTransform')
  expect(still).not.toContain('attributeName="r"')
  // What is left changes opacity, or is a clock hand; nothing repeats but the minute hand.
  const kinds = new Set([...still.matchAll(/<animate attributeName="([^"]+)"/g)].map(m => m[1]))
  expect([...kinds].sort()).toEqual(['opacity', 'stroke-dashoffset'])
  expect(still.split('repeatCount="indefinite"').length - 1).toBe(1)
  // The call is still there to see: its spoke flashes, the running station wears its ring, each subagent has a place.
  expect(still).toContain('values=".75;0"')
  expect(still.split('transform="rotate(').length - 1).toBe(full.split('transform="rotate(').length - 1 + 2)
  expect(setupFrom({ motion: 'none' }).motion).toBe('full')
})

test('the idle status line shows the model name when one is known', () => {
  const t = stringsFor('en')
  const empty: Board = { entries: [], counts: {} }
  const withModel: Board = { ...empty, model: 'claude-sonnet-4-5-20250514' }
  const withContext: Board = { ...withModel, context: 42 }
  expect(describeNow(empty, t)).toBe(t.idle)
  expect(describeNow(withModel, t)).toBe(`${t.idle} · ${shortModel('claude-sonnet-4-5-20250514')}`)
  expect(describeNow(withContext, t)).toContain(shortModel('claude-sonnet-4-5-20250514'))
  expect(describeNow(withContext, t)).toContain('42%')
})

test('a row is one line: its words are cut at the edge, its time has a column, and a long one opens on a press', { options: { textSize: 'body' } }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('tool.call', () => ({ result: {} }))
  const long = 'Run the plugin tests and then the validator on the whole folder'
  await $.tool.call({ tool: 'Bash', command: 'make', description: long })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const row = await ui.find({ type: 'Text', text: /Run the plugin tests/ })
    expect(row?.text).toContain(long)
    expect(row?.props.wrap).toBe('truncate-end')
    expect(row?.props.size).toBe('body')
    // A short label has nothing to open; the long one has one control, and a press turns its row to wrapping and back.
    const controls = await ui.findAll({ type: 'Button' })
    expect(controls.length).toBe(1)
    const key = String(controls[0]?.props.key)
    await ui.press({ key })
    expect((await ui.find({ type: 'Text', text: /Run the plugin tests/ }))?.props.wrap).toBe('wrap')
    expect((await ui.find({ type: 'Text', text: /content\.py/ }))?.props.wrap).toBe('truncate-end')
    await ui.press({ key })
    expect((await ui.find({ type: 'Text', text: /Run the plugin tests/ }))?.props.wrap).toBe('truncate-end')
    await ui.unmount()
  }
  expect(setupFrom({ textSize: 'huge' }).textSize).toBe('footnote')
})

test('the time stays on a row\'s first line, a moment holds a dash, and the answer row says how long the turn took', { options: OWN }, async ($, on) => {
  let clock = 1_000_000
  on('clock.now', () => ({ value: clock }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  await $.turn.start({ text: 'привет', turnId: 't1' } as never)
  clock += 42_000
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^42([.,]0)? с$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^—$/ })).toBeDefined()
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexDirection === 'row')
  expect(rows.length > 0 && rows.every(b => b.props.alignItems === 'flex-start')).toBe(true)
  await ui.unmount()
})

test('the line of now names the model once: not at its right while a model step is what runs', () => {
  const t = stringsFor('en')
  const step: Entry = { id: 's', station: 'model', label: 'opus 5.5 · step 1', from: 'core', startedAt: 1, status: 'run' }
  const call: Entry = { id: 'c', station: 'shell', label: 'make', from: 'core', startedAt: 2, status: 'run' }
  const board: Board = { entries: [], counts: {}, model: 'claude-opus-5-5', context: 8 }
  expect(nowParts(board, t)).toEqual({ what: t.idle, meter: '8% · opus 5.5' })
  expect(nowParts({ ...board, entries: [step] }, t)).toEqual({ what: 'Model: opus 5.5 · step 1', meter: '8%' })
  expect(nowParts({ ...board, entries: [step, call] }, t).meter).toBe('8% · opus 5.5')
  expect(stringsFor('ru').idle).toBe('Ожидание')
})

/** The plugin's store, kept in memory as the engine keeps it in a file. */
function fakeStore(on: (pattern: never, hook: never) => void): Map<string, unknown> {
  const kept = new Map<string, unknown>()
  const hook = (pattern: string, fn: (e: never) => unknown) => on(pattern as never, ((_: unknown, e: never) => fn(e)) as never)
  hook('store.get', (e: { key: string }) => ({ value: kept.get(e.key) }))
  hook('store.set', (e: { key: string; value: unknown }) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  return kept
}

test('on vscode the zoom buttons share the line of now, and the desktop pane has none', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await desktop.findAll({ type: 'Button' })).length).toBe(0)
  await desktop.unmount()
  const editor = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await editor.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['Zoom out', 'Zoom in', 'Hide map'])
  // One row holds the line of now and the buttons: they take no row of their own.
  const line = (await editor.findAll({ type: 'Box' })).find(b => b.props.flexDirection === 'row' && /Nothing yet|Nothing is running/.test(b.text ?? '') && /Zoom out/.test(b.text ?? ''))
  expect(line).toBeDefined()
  expect((await editor.findAll({ type: 'Box' })).some(b => b.props.position === 'absolute')).toBe(false)
  await editor.unmount()
})

test('the zoom buttons draw the map smaller or larger in the editor, and the next session keeps it', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const kept = fakeStore(on as never)
  const width = async (ui: { find: (q: { type: 'Svg' }) => Promise<{ props: Record<string, unknown> } | undefined> }) => (await ui.find({ type: 'Svg' }))?.props.width

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await width(ui)).toBeUndefined()
  await ui.press({ key: 'zoom-in' })
  expect(await width(ui)).toBeUndefined()
  await ui.press({ key: 'zoom-out' })
  await ui.press({ key: 'zoom-out' })
  expect(await width(ui)).toBe(340)
  expect((await ui.find({ type: 'Svg' }))?.props.height).toBe(Math.round(340 * 430 / 460))
  for (let i = 0; i < 10; i++) await ui.press({ key: 'zoom-out' })
  expect(await width(ui)).toBe(160)
  await ui.press({ key: 'zoom-in' })
  expect(kept.get('mapZoom')).toBe(200)
  await ui.unmount()

  // The desktop draws the map as it always has, whatever the editor was zoomed to.
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await width(desktop)).toBeUndefined()
  await desktop.unmount()

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const again = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await width(again)).toBe(200)
  await again.unmount()
})

test('minimized, the vscode pane is one line and a press restores the map', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const kept = fakeStore(on as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['Show map'])
  expect(kept.get('paneMin')).toBe(true)
  await ui.press({ key: 'show' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(kept.get('paneMin')).toBe(false)
  await ui.unmount()
})



const SPAWN = { prompt: 'PRIVATE7Q read every file', description: 'Count md files', subagentType: 'Explore' }

/** What stands beneath the mod for a subagent's step: a clock and a step that answers. Hooks go in before `$` is first called. */
function beneathAStep(on: any): void {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never
    return { turnId: 't2', index: 0, answer: '', toolUses: [] } as never
  })
}

/** One model step of subagent `a1`, left running, so its row is on the pane. */
async function stepOfSubagent($: any): Promise<void> {
  await $.turn.step({ ...stepOn('claude-haiku-5-5'), turnId: 't2', agentId: 'a1' } as never)[Symbol.asyncIterator]().next()
}

test('with subagentNames a subagent\'s step says which subagent it is, by its description and nothing else of the spawn', { options: { subagentNames: true } }, async ($, on) => {
  beneathAStep(on)
  let arrived: unknown
  on('agent.spawn', ((_: unknown, e: unknown) => ((arrived = e), { model: 'claude-haiku-5-5', agentId: 'a1' })) as never)
  const started = await $.agent.spawn(SPAWN as never)
  // The mod watches the spawn: what goes beneath is what was sent, and what comes back is what was answered.
  expect(arrived).toMatchObject(SPAWN)
  expect(started).toEqual({ model: 'claude-haiku-5-5', agentId: 'a1' } as never)
  await stepOfSubagent($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /haiku 5\.5 · step 1 · Count md files/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /PRIVATE7Q/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeUndefined()
  await ui.unmount()
})

test('without subagentNames a subagent\'s step says only that it is one', async ($, on) => {
  beneathAStep(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
  await $.agent.spawn(SPAWN as never)
  await stepOfSubagent($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /haiku 5\.5 · step 1 · subagent/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Count md files/ })).toBeUndefined()
  await ui.unmount()
})

test('with subagentNames a refused spawn comes back as it was written, and a subagent nobody named is a subagent', { options: { subagentNames: true } }, async ($, on) => {
  beneathAStep(on)
  on('agent.spawn', () => ({ deny: 'not now' }) as never)
  expect(await $.agent.spawn(SPAWN as never)).toEqual({ deny: 'not now' } as never)
  await stepOfSubagent($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /haiku 5\.5 · step 1 · subagent/ })).toBeDefined()
  await ui.unmount()
})

test('with subagentNames the steps of two subagents keep a row each, and without it they fold as before', () => {
  const steps = [entry('model', 1, { from: 'agents', agentId: 'a1' }), entry('model', 2, { from: 'agents', agentId: 'a2' }), entry('model', 3, { from: 'agents', agentId: 'a2' })]
  expect(foldRows(steps).map(r => r.times)).toEqual([3])
  expect(foldRows(steps, 16, true).map(r => [r.entry.agentId, r.times])).toEqual([
    ['a2', 2],
    ['a1', 1],
  ])
})

test('a call still running stays in the list however many rows came after it, as the last row, and leaves when it ends', () => {
  // Stations alternate so that nothing folds: every entry is a row of its own.
  const after = Array.from({ length: 20 }, (_, i) => entry(i % 2 === 0 ? 'files' : 'shell', 100 + i))
  const running = entry('shell', 1, { status: 'run', endedAt: undefined, task: 'b1', label: 'Run the long build' })
  const rows = foldRows([entry('files', 0), running, ...after])
  expect(rows.length).toBe(16)
  expect(rows[15]?.entry.label).toBe('Run the long build')
  // The fifteen above it are the newest, in order.
  expect(rows.slice(0, 15).map(r => r.entry.startedAt)).toEqual(Array.from({ length: 15 }, (_, i) => 119 - i))

  // Two of them: both stay, the newer above the older.
  const second = entry('agents', 2, { status: 'run', endedAt: undefined, label: 'Read the docs' })
  expect(foldRows([running, second, ...after]).slice(14).map(r => r.entry.label)).toEqual(['Read the docs', 'Run the long build'])

  // Ended, it is a row like any other and goes with the rest.
  const ended = { ...running, status: 'ok' as const, endedAt: 50 }
  expect(foldRows([ended, ...after]).some(r => r.entry.label === 'Run the long build')).toBe(false)
})

test('the last row of a full list folds only what stood next to it, not the same station further back', () => {
  // Model and shell in turn, forty of them: the sixteenth row is one call, with nothing of the older ones in it.
  const turns = Array.from({ length: 40 }, (_, i) => entry(i % 2 === 0 ? 'model' : 'shell', i))
  const rows = foldRows(turns)
  expect(rows.length).toBe(16)
  expect(rows.map(r => r.times)).toEqual(Array.from({ length: 16 }, () => 1))
  // What does stand next to it still folds in.
  const tail = [entry('model', 0), entry('model', 1), ...Array.from({ length: 15 }, (_, i) => entry(i % 2 === 0 ? 'shell' : 'files', 10 + i))]
  expect(foldRows([entry('shell', -1), ...tail])[15]?.times).toBe(2)
})

test('thirty background tasks still running take half the list, the last of them standing for the rest, and the newest calls keep the other half', () => {
  const tasks = Array.from({ length: 30 }, (_, i) => entry('agents', i, { status: 'run', endedAt: undefined, task: `b${i}`, label: `task ${i}` }))
  const after = Array.from({ length: 20 }, (_, i) => entry(i % 2 === 0 ? 'files' : 'shell', 100 + i))
  const rows = foldRows([...tasks, ...after])
  expect(rows.length).toBe(16)
  // The newest eight calls, then the newest eight of the tasks; the eighth stands for the twenty-two older ones.
  expect(rows.slice(0, 8).map(r => r.entry.startedAt)).toEqual([119, 118, 117, 116, 115, 114, 113, 112])
  expect(rows.slice(8).map(r => r.entry.label)).toEqual(['task 29', 'task 28', 'task 27', 'task 26', 'task 25', 'task 24', 'task 23', 'task 22'])
  expect(rows.slice(8).map(r => r.times)).toEqual([1, 1, 1, 1, 1, 1, 1, 23])
  // Every one of the thirty is counted once.
  expect(rows.slice(8).reduce((n, r) => n + r.times, 0)).toBe(30)
})

const stationOf = (command: string, tool = 'Bash') => classify(tool, { command }, STRANGER).station

test('a command inside a loop, a condition, a group or a negation is still the command', () => {
  expect(stationOf('for u in a b; do curl $u; done')).toBe('web')
  expect(stationOf('if curl -sf x; then echo ok; fi')).toBe('web')
  expect(stationOf('if test -f a; then echo ok; else wget x; fi')).toBe('web')
  expect(stationOf('while ! curl -sf x; do sleep 1; done')).toBe('web')
  expect(stationOf('until ping -c1 host; do sleep 1; done')).toBe('web')
  expect(stationOf('! curl x')).toBe('web')
  expect(stationOf('{ curl x; }')).toBe('web')
  expect(stationOf('(cd /tmp && curl x)')).toBe('web')
  // The words of the construct are no commands: a loop over files that only reads them is files.
  expect(stationOf('for f in *.md; do cat $f; done')).toBe('files')
  expect(stationOf('if grep -q x a.txt; then echo yes; fi')).toBe('files')
  expect(stationOf('while read line; do echo $line; done')).toBe('shell')
  expect(stationOf('for i in 1 2 3; do make test; done')).toBe('shell')
  // A file named like a keyword is an argument, not a construct.
  expect(stationOf('cat do then fi')).toBe('files')
})

test('a command handed to a shell, to eval or to watch is the command that counts', () => {
  expect(stationOf('bash -c "curl https://x.y"')).toBe('web')
  expect(stationOf("sh -c 'wget x'")).toBe('web')
  expect(stationOf('zsh -lc "git fetch && make"')).toBe('web')
  expect(stationOf('eval "curl x"')).toBe('web')
  expect(stationOf('watch -n 5 curl x')).toBe('web')
  expect(stationOf('find . -exec sh -c "curl x" \;')).toBe('web')
  expect(stationOf('sudo bash -c "apt-get update && apt-get install -y jq"')).toBe('web')
  expect(stationOf("bash -c 'cat a | sort'")).toBe('files')
  expect(stationOf('bash -c "make build"')).toBe('shell')
  // A script is not a command line: what it does is not read.
  expect(stationOf('bash deploy.sh curl')).toBe('shell')
  // Shells inside shells stop being read at some depth, and nothing breaks.
  expect(stationOf(`bash -c "bash -c 'bash -c \\"bash -c curl\\"'"`)).not.toBe('files')
})

test('what parts two commands parts them only outside quotes', () => {
  // A pattern, a script or a filter with `|` or `;` in it is one argument of a command that works on files.
  for (const c of ['grep -E "ssh|curl" log.txt', 'grep -rn "foo|bar" src', 'rg "push|pull" .', 'sed "s/a/b/; s/curl/x/" f', "awk '{print $1; }' f", "jq '.a | .b' f.json", 'cat f | grep -E "wget|nc"', `bash -c "grep -E 'a|b' f"`, 'find . -name "*.ts" -exec grep -l "a|b" {} \\;', "find . -exec grep -l 'a;b' {} ';'"]) {
    expect([c, stationOf(c)]).toEqual([c, 'files'])
  }
  // Text that names a network command runs none.
  for (const c of ['git commit -m "fix: retry; curl fallback"', 'echo "a; wget b"', 'echo "for u; do curl; done"', `echo "it's; curl"`, 'echo "a \\" ; curl x"', 'echo a\\; curl', "echo $'it\\'s; curl x'", 'make # then; curl x', "make # don't; curl x"]) {
    expect([c, stationOf(c)]).toEqual([c, 'shell'])
  }
  // Outside the quotes the same characters still part commands, and a command after a comment's line is read.
  for (const c of ['grep "a" f && curl x', 'echo "a"; curl x', "make # don't\ncurl x", 'echo a\\\\; curl x', 'bash -c "echo \\"hi\\"; curl x"', 'sleep 5 & curl x', 'make |& curl -T - x']) {
    expect([c, stationOf(c)]).toEqual([c, 'web'])
  }
  // Sending output somewhere ends no command, and a backslash at a line's end joins two lines.
  expect(stationOf('ls a 2>&1')).toBe('files')
  expect(stationOf('ls a &> out.txt')).toBe('files')
  expect(stationOf('git \\\n  push origin main')).toBe('web')
  // Double quotes do not stop a command inside them from running; single quotes do.
  expect(stationOf('echo "$(curl x)"')).toBe('web')
  expect(stationOf('echo "now `curl x` done"')).toBe('web')
  expect(stationOf('git commit -m "$(date); $(curl x)"')).toBe('web')
  expect(stationOf("echo '$(curl x)'")).toBe('shell')
  expect(stationOf("echo '`curl x`'")).toBe('shell')
  // The text beside a command run inside quotes is still text.
  expect(stationOf('echo "$(date) curl x"')).toBe('shell')
  // A line handed to a shell in single quotes is run by that shell, and what it runs inside is found.
  expect(stationOf("bash -c 'echo $(curl x)'")).toBe('web')
  expect(stationOf('case $1 in a) curl x ;; esac')).toBe('web')
  // PowerShell: a backslash is a path's, and a backtick keeps the character after it.
  expect(stationOf('Select-String "a|b" f.txt', 'PowerShell')).toBe('files')
  expect(stationOf('Write-Host "a; curl b"', 'PowerShell')).toBe('shell')
  expect(stationOf('Get-Content "C:\\dir\\"; curl x', 'PowerShell')).toBe('web')
  expect(stationOf('Write-Host a`; curl', 'PowerShell')).toBe('shell')
  expect(stationOf('& "C:\\Program Files\\Git\\cmd\\git.exe" push', 'PowerShell')).toBe('web')
})

test('the text of a here-document is no command, whatever it says', () => {
  expect(stationOf('cat <<EOF > f\ncurl x\nEOF')).toBe('files')
  expect(stationOf("cat <<'EOF' > notes.md\nsome text\nwget y\nEOF")).toBe('files')
  expect(stationOf('cat <<-EOF > f\n\tcurl x\n\tEOF')).toBe('files')
  expect(stationOf('python3 - <<"PY"\nimport os\ncurl = 1\nPY')).toBe('shell')
  // What follows the here-document is read again.
  expect(stationOf('cat <<EOF > f\ntext\nEOF\ncurl x')).toBe('web')
  expect(stationOf('cat <<A > a; cat <<B > b\none\nA\ncurl\nB\nls')).toBe('files')
  // One that never ends is all text.
  expect(stationOf('cat <<EOF > f\ncurl x')).toBe('files')
  // A here-string is one word, and a shift is arithmetic.
  expect(stationOf('grep x <<< "curl"')).toBe('files')
  expect(stationOf('echo $((1 << 2)); curl x')).toBe('web')
  // PowerShell has no here-documents of this kind.
  expect(stationOf('Get-Content a.txt', 'PowerShell')).toBe('files')
})

test('a here-document handed to a shell is that shell\'s script', () => {
  for (const c of ['bash <<EOF\ncurl x\nEOF', "bash -s <<'EOF'\nset -e\nwget y\nEOF", 'sudo sh <<EOF\napt-get update\nEOF', 'echo start && zsh <<-EOF\n\tgit push\n\tEOF', 'bash <<EOF\necho hi']) {
    if (c.endsWith('hi')) expect([c, stationOf(c)]).toEqual([c, 'shell'])
    else expect([c, stationOf(c)]).toEqual([c, 'web'])
  }
  // The word that ends it is no command, and what follows is read as before.
  expect(stationOf('bash <<EOF\necho hi\nEOF')).toBe('shell')
  expect(stationOf('bash <<EOF\necho hi\nEOF\ncurl x')).toBe('web')
  // A shell that was given a script, or a line with -c, reads the here-document as that script's input: text.
  expect(stationOf('bash deploy.sh <<EOF\ncurl x\nEOF')).toBe('shell')
  expect(stationOf('bash -c "cat > f" <<EOF\ncurl x\nEOF')).toBe('files')
  // Another language's script is not read, and neither is text piped on to a shell.
  expect(stationOf('python3 - <<PY\nimport os\ncurl = 1\nPY')).toBe('shell')
  expect(stationOf('cat <<EOF | bash\ncurl x\nEOF')).toBe('shell')
})

test('the command docker runs in a container is the command that counts', () => {
  for (const c of ['docker exec c curl x', 'docker exec -it -u root c curl x', 'docker run alpine wget x', 'docker run --rm -v "$PWD:/w" -w /w alpine wget x', 'docker run --rm alpine sh -c "curl x"', 'docker compose exec web curl x', 'docker compose run --rm web npm install', 'docker -H tcp://h:2375 exec c curl y', 'docker container exec c ping h', 'sudo docker exec c curl x']) {
    expect([c, stationOf(c)]).toEqual([c, 'web'])
  }
  // A name or a value that reads like a command is not one, and a command that stays in the container is Shell.
  for (const c of ['docker exec c ls', 'docker run --name curl alpine ls', 'docker run -e A=1 --network=host img git status', 'docker run alpine', 'docker ps', 'docker exec c cat /etc/hosts', 'docker logs curl']) {
    expect([c, stationOf(c)]).toEqual([c, 'shell'])
  }
})

test('a command line is read up to a length, and a long one costs no more than that', () => {
  // Past the first eight thousand characters nothing is read: the label and the station come from what stands before.
  const long = `ls ${'a'.repeat(9000)}; curl x`
  expect(stationOf(long)).toBe('files')
  expect(stationOf(`curl x; ls ${'a'.repeat(9000)}`)).toBe('web')
  const pipes = 'x|'.repeat(100_000)
  for (let i = 0; i < 3; i++) stationOf(pipes)
  const t0 = performance.now()
  stationOf(pipes)
  const ms = performance.now() - t0
  console.log(`COST naming a 200,000-character line of pipes: ${ms.toFixed(1)} ms`)
  expect(ms).toBeLessThan(100)
  const doc = `cat <<EOF > f\n${'line of text here\n'.repeat(11_000)}EOF\ncurl x`
  for (let i = 0; i < 3; i++) stationOf(doc)
  const t1 = performance.now()
  // The command after a long here-document is still seen.
  expect(stationOf(doc)).toBe('web')
  const docMs = performance.now() - t1
  console.log(`COST naming a 200,000-character here-document: ${docMs.toFixed(1)} ms`)
  expect(docMs).toBeLessThan(100)
})

test('more commands that reach the network are known by name or by subcommand', () => {
  for (const c of ['pip3.12 install x', 'pip3 download x', 'bun i', 'yarn', 'yarn --frozen-lockfile', 'git submodule update --init', 'git remote update', 'svn checkout u', 'hg clone u', 'kubectl get pods', 'aws s3 ls', 'gcloud auth list', 'az login', 'terraform apply', 'helm install x ./chart', 'nmap host', 'http GET x.y', 'openssl s_client -connect x:443', 'deno install']) {
    expect([c, stationOf(c)]).toEqual([c, 'web'])
  }
  // The same programs at work on what is already here stay on Shell.
  for (const c of ['yarn build', 'git submodule status', 'git remote -v', 'terraform fmt', 'helm template .', 'openssl sha256 a.bin', 'deno run a.ts', 'svn status', 'bunx cowsay', 'npx cowsay']) {
    expect([c, stationOf(c)]).toEqual([c, 'shell'])
  }
})

test('a running row is in a colour of its own, apart from the colour of a failed one', { options: { language: 'ru' } }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  let n = 0
  on('tool.call', () => {
    return (n++ === 0 ? { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } } : { result: {}, isError: true }) as never
  })

  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Ждать сборку', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'curl example.com', description: 'Спросить сервер' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const running = await ui.find({ type: 'Text', text: /● .*Ждать сборку/ })
  const failed = await ui.find({ type: 'Text', text: /✕ .*Спросить сервер/ })
  expect(running?.props.color).toBe('ide')
  expect(failed?.props.color).toBe('error')
  await ui.unmount()
})

test('guardedHooks is on unless switched off, in either spelling', () => {
  expect(setupFrom({}).guardedHooks).toBe(true)
  expect(setupFrom({ guardedHooks: 'nonsense' }).guardedHooks).toBe(true)
  expect(setupFrom({ guardedHooks: false }).guardedHooks).toBe(false)
  expect(setupFrom({ guardedHooks: 'false' }).guardedHooks).toBe(false)
})

test('with guardedHooks off a call a hook refused reads as failed, and no hook of the five leaves a row', { options: { ...OWN, guardedHooks: false } }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.PreToolUse', () => ({ deny: 'JUDGE: found key sk-private\nCommand: secret' }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#1971 excerpt] тайный текст записи'] }))
  on('classic.SessionStart', () => ({ additionalContext: ['• [#277 excerpt] ещё'] }))
  on('skill.prompt', (_, e) => ({ text: e.text }) as never)
  on('session.compact', () => ({ skip: 'test' }) as never)
  on('tool.call', () => ({ result: {} }))
  let kept: Board = { entries: [], counts: {} }
  on('state.set', ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept = e.value?.value ?? kept), next(e))) as never)

  await $.classic.SessionStart({ source: 'startup' } as never)
  await $.classic.UserPromptSubmit({ prompt: 'привет', permission_mode: 'default' } as never)
  await $.skill.prompt({ skill: 'deploy', text: '' } as never)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'kept', toolUses: [] }] } as never)
  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })

  // The mark is the same for a blocked call and for a failed one, so the row's own status is read. Without its
  // hook on classic.PreToolUse the mod cannot tell a refusal from an error: the call comes back as an error.
  expect(kept.entries.filter(e => e.station === 'shell').map(e => e.status)).toEqual(['err'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Показать статус/ }))?.text).toContain('✕')
  expect(await ui.find({ type: 'Text', text: /Хуки|deploy|#1971|#277|JUDGE|sk-private/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(SETUP.t.compacting) })).toBeUndefined()
  await ui.unmount()
})

test('with no surface attached at the start the pane is not opened; it opens when a surface joins', async ($, on) => {
  let opens = 0
  let roster: string[] = []
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.surfaces', () => ({ value: roster }) as never)
  on('ui.open', () => {
    opens++
    return { value: roster.length > 0 ? { isPlaced: true } : { isPlaced: false, reason: 'no-surface' } } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }) as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens).toBe(0)

  roster = ['desktop']
  await $.session.attach({ clientId: 'c1', surface: 'desktop' } as never)
  expect(opens).toBe(1)
})

test('with a surface attached at the start the pane is opened at once', async ($, on) => {
  let opens = 0
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('ui.open', () => {
    opens++
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opens).toBe(1)
})
