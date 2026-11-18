// My space (space.html): what the connected wallet holds on Arc, in tabs (src/space). App frame, live reading, footer
// and copilot like the other app pages.
import './styles.css'
import './app/app.css'
import { bootPage } from './app/parts'
import { SpacePage } from './space/SpacePage'

bootPage(<SpacePage />, 'ArcHive. My space')
