// Entry point of the old Publish page: publishing a service is now the Publish part of the Network page
// (network.html?focus=publish), where its steps (connect, manifest, fingerprint, propose, activate) are signed in place.
import { toNetwork } from './toNetwork'

toNetwork('publish')
