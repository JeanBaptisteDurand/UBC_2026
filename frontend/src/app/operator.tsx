// Entry point of the operator page.
import '../styles.css'
import './app.css'
import { xTitle } from '../network/actions/strings-x'
import { bootPage } from './parts'
import { OperatorPage } from './OperatorPage'

bootPage(<OperatorPage />, xTitle('o.doc'))
