// Entry point of the bounty page.
import '../styles.css'
import './app.css'
import { xTitle } from '../network/actions/strings-x'
import { bootPage } from './parts'
import { BountyPage } from './BountyPage'

bootPage(<BountyPage />, xTitle('b.doc'))
