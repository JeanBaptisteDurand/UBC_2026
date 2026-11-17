// Entry point of the sessions page.
import '../styles.css'
import './app.css'
import { xTitle } from '../network/actions/strings-x'
import { bootPage } from './parts'
import { SessionsPage } from './SessionsPage'

bootPage(<SessionsPage />, xTitle('s.doc'))
