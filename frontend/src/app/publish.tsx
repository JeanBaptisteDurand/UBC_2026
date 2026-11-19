// Entry point of the publish page.
import '../styles.css'
import './app.css'
import { t } from '../i18n'
import { bootPage } from './parts'
import { PublishPage } from './PublishPage'

bootPage(<PublishPage />, t('pp.doc'))
