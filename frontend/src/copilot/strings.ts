// Copilot text, in English: the site is English only (src/i18n.ts, getLang() is always 'en'). The suggestions keep
// their French lists only because their type pairs both languages; they are never shown. Same rules as i18n.ts: no
// visible text with a middle dot, semicolon, em dash or arrow; ellipses only in truncated hashes.
import { getLang } from '../i18n'

const EN = {
  'enc.checking': 'Checking its enclave on Arc', 'enc.on.a': 'Sealed in its own enclave', 'enc.on.b': 'verified on Arc',
  'enc.clear.a': 'Enclave verified on Arc', 'enc.clear.b': 'not sealed here',
  'enc.off.a': 'Enclave not verified', 'enc.off.b': 'server answers',
  'enc.srv.a': 'Enclave verified on Arc', 'enc.srv.b': 'last answer: ArcHive server, not sealed',
  'enc.conv.srv': 'the last answer came from the ArcHive server, not sealed and not signed by the enclave: the enclave did not answer',
  'route.down': 'The enclave is not reachable right now: this answer comes from ArcHive’s server, not sealed.',
  'enc.aria': 'Show the proof read on Arc', 'enc.h': 'Proof, read on Arc',
  'enc.key': 'Enclave key', 'enc.op': 'Operator', 'enc.prod': 'Product', 'enc.prod.v': '#{n}, AskHive', 'enc.reg': 'Registered from', 'enc.blk': 'block {n}',
  'enc.img': 'Image fingerprint', 'enc.quote': 'Intel quote', 'enc.quote.v': 'DCAP verified on Arc, {tcb}', 'enc.tcb.0': 'TCB up to date', 'enc.tcb.n': 'TCB status {n}',
  'enc.conv': 'Conversation', 'enc.conv.on': 'sealed to the enclave (HPKE), key {k}', 'enc.conv.clear': 'not sealed here: sealing needs the site over HTTPS (arc-hive.xyz); on this page the ArcHive server answers',
  'enc.model': 'Model', 'enc.model.v': 'runs at RedPill, behind an attested gateway (Intel TDX) the enclave checks before every call: that gateway and the model also read the conversation.',
  'enc.checked': 'Key checked', 'enc.checked.v': 'at block {n}, {t}', 'enc.again': 'Check again',
  'enc.off.p': 'Its key could not be checked on Arc ({why}): nothing is sealed, the ArcHive server answers.', 'enc.why.mismatch': 'the key does not match the one registered', 'enc.why.unreachable': 'the enclave does not answer',
  'launch': 'AskHive',
  'launch.aria': 'Open AskHive, the ArcHive assistant',
  'title': 'AskHive',
  'sub': 'Shows you the site, prepares what you sign',
  'close': 'Close AskHive',
  'new': 'Start over',
  'mcp.btn': 'MCP',
  'mcp.btn.aria': 'Use these tools from your own agent (MCP)',
  'mcp.back': 'Back to the conversation',
  'intro': 'Ask me about the network. I answer with my sources, show you the right place on the site, and prepare the operations you sign with your own wallet. Nothing is spent without your signature.',
  'intro.mcp': 'Use these tools from your own agent',
  'suggest': 'Suggestions',
  'placeholder': 'Ask AskHive',
  'input.label': 'Your message to AskHive',
  'send': 'Send',
  'thinking': 'AskHive is thinking',
  'think.seal': 'Sealing your question for the enclave…',
  'think.enclave': 'The enclave is answering…',
  'think.server': 'AskHive is thinking…',
  'think.secs': ', {n}\u00a0s',
  'you': 'You',
  'copilot': 'AskHive',
  'sources': 'Sources: {list}',
  'tools': 'Tools: {list}',
  'driving': 'AskHive is showing you the site',
  'driving.back': 'Back to the chat',
  'err.unreachable': 'I can’t reach AskHive ({url}). Check your connection, then try again.',
  'err.slow': 'AskHive took too long to answer. Try again in a moment.',
  'err.refused': 'AskHive refused the request (HTTP {status}).',
  'err.unreadable': 'AskHive’s answer could not be read (HTTP {status}).',
  'err.empty': 'AskHive sent an empty answer.',
  // pages and steps played on the site
  'page.home': 'the home page', 'page.use': 'Network, Use', 'page.service': 'Services', 'page.rent': 'Network, Rent',
  'page.publish': 'Network, Publish', 'page.network': 'the Network page', 'page.doc': 'the Doc', 'page.space': 'My space', 'page.bounty': 'My space, My bounties', 'page.sessions': 'My space, My sessions', 'page.operator': 'My space, My machines', 'page.demo': 'the demo', 'page.datacenter': 'the 3D server room', 'page.console': 'the console',
  'step.open': 'Opened {page}',
  'step.search': 'Typed “{q}” in the search',
  'step.clear': 'Cleared the search',
  'step.state': 'Filter: {f}',
  'step.kind': 'Kind: {k}',
  'step.row': 'Pointed out product #{id}',
  'step.section': 'Scrolled to {s}',
  'step.hl': 'Highlighted {t}',
  'step.missing': 'Not on this page: {t}',
  'step.demo.play': 'Demo playing', 'step.demo.pause': 'Demo paused', 'step.demo.next': 'Next demo step',
  'step.demo.prev': 'Previous demo step', 'step.demo.goto': 'Demo step {n}',
  'target.product': 'product #{id}',
  'target.bounty': 'bounty #{id} (product #{p})',
  'note.from': 'AskHive',
  // wallet
  'wal.none': 'No wallet in this browser',
  'wal.pick': 'Several wallets here. Choose one',
  'enc.held': 'The enclave did not answer. This conversation was sealed to it, so it is not sent anywhere else in clear. Try again in a moment, or start over to ask the ArcHive server.',
  'wal.how': 'How to get one',
  'wal.howText': 'Install a browser wallet such as MetaMask or Rabby, then reload this page. On a phone, open this page in your wallet’s own browser. AskHive adds Arc testnet to it for you.',
  'wal.faucet': 'Get test USDC from Circle’s faucet',
  'wal.connect': 'Connect wallet',
  'wal.connecting': 'Check your wallet',
  'wal.connected': 'Wallet',
  'wal.arc': 'Arc testnet',
  'wal.other': 'Another network',
  'wal.switch': 'Switch to Arc testnet',
  'wal.forget': 'Disconnect',
  'wal.rejected': 'You declined in your wallet.',
  'wal.pending': 'Your wallet already has a request open. Open it to answer.',
  'wal.err': 'The wallet did not answer: {e}',
  'wal.label': 'Wallet status',
  'wal.off': 'Not connected, Arc testnet',
  'wal.dismiss': 'Dismiss this message',
  // prepared actions (the console's CopilotActions.tsx)
  'card.prepared': 'Prepared for your signature',
  'card.info': 'Prepared by AskHive',
  'card.session': 'Open a session and get your access key',
  'card.bond': 'Post your operator bond',
  'card.register': 'Register an enclave on Arc',
  'svc': 'AskHive is itself a service on Arc, sealed in its own machine.', 'svcL': 'See its page',
  'card.bounty': 'Post a sealed bounty',
  'card.quote': 'Price estimate',
  'card.snippet': 'Code example',
  'card.scaffold': 'Your service, ready to build',
  'card.test': 'A test call',
  'card.unknown': 'Prepared action',
  'l.product': 'Product #{id}', 'l.enclave': 'Enclave {e}', 'l.operator': 'Operator {o}', 'l.deposit': 'Deposit {d}',
  'l.amount': 'Amount {a}', 'l.after': 'Available afterwards {a}', 'l.funding': 'Funding {f}', 'l.deadline': 'Deadline {d}',
  'l.rail': 'Rail {r}', 'l.price': 'Price {p}', 'l.price.call': 'Price per call {p}', 'l.price.tok': 'Price per token {p}', 'l.units': 'Units {u}', 'l.total': 'Total {t}', 'l.budget': 'Budget per request {b}',
  'l.maxUnits': 'Units per request at most {u}', 'l.example': 'Example deposit {d}', 'l.name': 'Name {n}', 'l.minBond': 'Minimum bond {b}',
  'checks': 'Checks',
  'warnings': 'Warnings',
  'steps': 'Steps',
  'sign': 'Sign with my wallet',
  'sign.connect': 'Connect a wallet to sign',
  'sign.switch': 'Switch to Arc testnet to sign',
  'checks.failed': 'A check failed. Fix it before signing, the transaction would be refused.',
  'todo': 'To complete: {why}',
  'todo.incomplete': 'incomplete parameters',
  'todo.amount': 'the amount is missing',
  'todo.bounty': 'incomplete parameters (the protocol’s X25519 key?)',
  'session.none': 'No enclave is active for this product right now, so no session can be opened. AskHive can open one as soon as an operator registers an enclave.',
  'register.why': 'Registering an enclave runs on your operator machine: its agent asks the enclave for a fresh Intel quote, then your wallet signs. Open the operator console to do it.',
  'register.open': 'Open the operator console',
  'other.addr': 'Prepared for {a}, but your wallet is {b}. Ask AskHive again with this wallet.',
  'ph.sign': 'Sign in your wallet',
  'ph.switch': 'Switching your wallet to Arc testnet',
  'ph.sent': 'Sent, waiting for Arc',
  'ph.done': 'Confirmed on Arc',
  'ph.reverted': 'Arc reverted the transaction',
  'ph.rejected': 'You declined in your wallet',
  'ph.error': 'Not sent: {e}',
  'ph.refused': 'Refused by the contract: {e}',
  'ph.rpc': 'Arc’s RPC is busy. Try again in a few seconds.',
  'ph.unconfirmed': 'Not confirmed yet. Follow the transaction in the explorer.',
  'tx': 'Transaction',
  'tx.open': 'View on the explorer',
  'bounty.id': 'Bounty #{id}',
  'session.id': 'Session #{id}',
  'aek.title': 'Your access key, shown only once',
  'aek.copy': 'Copy the full key',
  'aek.note': 'Keep it like a password. Manage it later in the console, Keys and sessions.',
  'after.show': 'See it on the site',
  'after.bond': 'Done: your bond of {a} is held by OperatorBond. Next, install the agent on your machine.',
  'after.bounty': 'Bounty #{id} is on Arc for this product.',
  'after.session': 'Session #{id} pays this product per use.',
  'copy': 'Copy',
  'copied': 'Copied',
  'code': 'Code',
  'table': 'Table',
  'open.publish': 'Open the Publish page',
  // MCP
  'mcp.title': 'Use these tools from your own agent',
  'mcp.lede': 'Claude, Cursor or any MCP client can call the same tools as AskHive. They read the network and prepare operations. They never sign.',
  'mcp.server': 'MCP server',
  'mcp.json': 'JSON config, for Cursor and any client that takes a remote server URL',
  'mcp.claude': 'In Claude, desktop or web, add a custom connector with the server URL. In Claude Code:',
  'mcp.note': 'Streamable HTTP, no account, no key. Every operation it prepares is signed in your own wallet.',
}
type Key = keyof typeof EN

/** Suggestions for the empty conversation, depending on the open page: three for the page, then the three every page
 *  offers (renting out a machine, ArcHive in Claude Code, the MCP). */
const SUGGEST: Record<string, { en: string[]; fr: string[] }> = {
  home: {
    en: ['What am I looking at?', 'Show me a demo', 'Show me the services running now'],
    fr: ['Qu’est-ce que je regarde ?', 'Montrez-moi une démo', 'Montrez-moi les services en marche'],
  },
  network: {
    en: ['Show me a demo', 'What does Arc check before anyone pays?', 'Show me the services running now'],
    fr: ['Montrez-moi une démo', 'Que vérifie Arc avant que quiconque paie ?', 'Montrez-moi les services en marche'],
  },
  use: {
    en: ['Show me the private AI services', 'How much does a private AI call cost?', 'I want to post a bounty'],
    fr: ['Montrez-moi les services d’IA privée', 'Combien coûte un appel d’IA privée ?', 'Je veux publier une prime'],
  },
  service: {
    en: ['Explain this service', 'How do I use it?', 'Who runs it, and what did Arc check?'],
    fr: ['Expliquez-moi ce service', 'Comment l’utiliser ?', 'Qui le fait tourner, et qu’a vérifié Arc ?'],
  },
  rent: {
    en: ['Prepare my bond deposit', 'What does the bond protect?', 'Walk me through the steps'],
    fr: ['Préparez le dépôt de ma caution', 'À quoi sert la caution ?', 'Montrez-moi les étapes'],
  },
  publish: {
    en: ['How do I publish my own service?', 'Prepare a skeleton for my service', 'What does the manifest fix?'],
    fr: ['Comment publier mon propre service ?', 'Préparez le squelette de mon service', 'Que fixe le manifeste ?'],
  },
  demo: {
    en: ['Play the demo', 'Explain this step', 'Pause the demo'],
    fr: ['Lancez la démo', 'Expliquez-moi cette étape', 'Mettez la démo en pause'],
  },
  // Services without a sheet open (the catalog): AskHive picks the services itself
  catalog: {
    en: ['Which services run right now?', 'What does each service do?', 'How do I pay for a service?'],
    fr: ['Quels services tournent en ce moment ?', 'Que fait chacun des services ?', 'Comment payer un service ?'],
  },
}
const EVERY = {
  en: ['How do I rent out my machine?', 'How do I set up ArcHive with my Claude Code (inference and enclaves)?', 'How do I set up the ArcHive MCP?'],
  fr: ['Comment louer ma machine ?', 'Comment brancher ArcHive dans mon Claude Code (inférence et enclaves) ?', 'Comment installer le MCP d’ArcHive ?'],
}

export type CKey = Key
export function ct(k: Key, vars?: Record<string, string | number>): string {
  let s: string = EN[k] ?? k
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(String(b))
  return s
}
/** The page's own name, read from its title ("ArcHive. Doc. Tokenomics", "ArcHive. Attested Copilot"): the Doc
 *  chapter open, or the service whose sheet is open. The questions name it, since the enclave is not told the page. */
export function pageName(page: string | null, title = document.title): string | undefined {
  const parts = title.split('. ').map((x) => x.trim()).filter(Boolean)
  const n = page === 'doc' ? parts.slice(2).join('. ') : parts.slice(1).join('. ')
  return n && n.length <= 60 ? n : undefined
}
/** The questions offered on a page. page: pageOf(), or 'demo' while the Network page's 3D demo is open, or 'catalog'
 *  on Services without a sheet open; name: pageName() */
export function suggestions(page: string | null, name?: string): string[] {
  const l = getLang() === 'fr' ? 'fr' : 'en'
  const fr = l === 'fr'
  const own: Record<string, string[]> = {
    home: fr ? ['Expliquez la page d’accueil d’ArcHive'] : ['Explain the ArcHive home page'],
    network: fr ? ['Expliquez la page Réseau'] : ['Explain the Network page'],
    bridge: fr ? ['Expliquez la page Bridge'] : ['Explain the Bridge page'],
    doc: name ? (fr ? [`Expliquez ce chapitre : ${name}`] : [`Explain this chapter: ${name}`]) : (fr ? ['Expliquez la page Doc'] : ['Explain the Doc page']),
  }
  if (page === 'service' && name) {
    const s = fr
      ? [`Expliquez ce service : ${name}`, `Comment utiliser ${name} ?`, `Quel opérateur fait tourner ${name}, et qu’a vérifié Arc ?`]
      : [`Explain this service: ${name}`, `How do I use ${name}?`, `Which operator runs ${name}, and what did Arc check?`]
    return [...s, ...EVERY[l]]
  }
  const base = (SUGGEST[page ?? 'home'] ?? SUGGEST.home)[l]
  const first = own[page ?? 'home'] ?? (name && !SUGGEST[page ?? 'home'] ? [fr ? `Expliquez cette page : ${name}` : `Explain this page: ${name}`] : [])
  // the home set's "What am I looking at?" does not say where the visitor is: the page's own question replaces it
  const rest = base.filter((q) => q !== SUGGEST.home![l][0])
  return [...new Set([...first, ...rest])].slice(0, 3).concat(EVERY[l])
}
