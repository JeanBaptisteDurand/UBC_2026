// Entry point of the old Use page: using a service is now the Use part of the Network page
// (network.html?focus=use). The address is kept with its query, so ?p=<product> and old links land on that service.
import { toNetwork } from './toNetwork'

toNetwork('use')
