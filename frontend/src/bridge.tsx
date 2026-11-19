// The bridge (bridge.html): USDC from another testnet to Arc testnet with CCTP V2, signed by the visitor's wallet
// (src/bridge). App frame, live reading, footer and copilot like the other app pages.
import './styles.css'
import './app/app.css'
import { bootPage } from './app/parts'
import { BridgePage } from './bridge/BridgePage'

bootPage(<BridgePage />, 'ArcHive. Bridge')
