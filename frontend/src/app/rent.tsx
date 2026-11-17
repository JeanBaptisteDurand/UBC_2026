// Entry point of the rent page.
import '../styles.css'
import './app.css'
import { t } from '../i18n'
import { bootPage } from './parts'
import { RentPage } from './RentPage'

bootPage(<RentPage />, t('r.doc'))
