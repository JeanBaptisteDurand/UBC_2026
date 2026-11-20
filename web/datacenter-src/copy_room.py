# The room's words, in English and French, written over the engine's (base-copy.json): racks instead of pods.
# usage: copy_room.py <base-copy.json> <out file>
import json, sys
src, out = sys.argv[1], sys.argv[2]
c = json.load(open(src, encoding='utf-8'))
EN = {
 'brand.tagline': 'watch sealed servers get checked and paid',
 'tour': [
  ['Welcome to the ArcHive server room', 'This is how ArcHive works, told as a server room. Every cabinet is a slot where an enclave can run, and every event you will see happened on Arc testnet. We replay that history faster so you can watch it.'],
  ['At the counter, a client asks for a service', 'An app or a person asks for a service: a private AI, a paid call, a bounty. It checks on Arc the key of the enclave that will serve it, then seals its request for that enclave alone. It pays per use, in USDC.'],
  ['The request goes to the back, where a technician starts an enclave', "The sealed request rides to the server hall. For a service to exist, an operator starts an enclave: the service's exact code goes into a cabinet, an Intel TDX machine, and the operator locks a USDC bond. Only an enclave started with the product's exact code is accepted."],
  ['Inside a cabinet, even the owner is locked out', "Intel TDX encrypts the server's memory, so the operator who owns the machine cannot read what runs inside. Its keys are born there, and Arc checks a fingerprint of the exact code it runs."],
  ['Three layers come down from Arc', 'The silicon is half the story. Over the racks float three records kept on Arc: the registry of enclaves that passed the check, the product contract that fixes code, price and revenue split, and the bond that makes lying expensive.'],
  ['Arc checks every enclave', "Each enclave's chip signs a quote that says which code runs, on which processor, at which security level. A contract on Arc checks Intel's signature itself. Debug mode, missing security updates, unknown code or an old quote: the enclave serves no one. Checks repeat about every 12 hours."],
  ['The robot notary runs it again', "Some work can be checked by running it again. A hunter's exploit is replayed in an enclave on a fork of Arc and paid only if the loss is real. A machine caught lying loses its bond, split between the reporter and the victim."],
  ['Now explore', 'Click any cabinet to see the real enclave behind it and its history on Arc. The magnifier finds any key or transaction. Replay the history, jump to the lying machine, or open the console to use the services yourself.'],
 ],
 'zones.pad': ['Loading dock', 'Operators ship their machines here. Each one is an Intel TDX server that the operator rents out to the network. Before it can earn anything, the operator locks a USDC bond that a proven lie would cost.'],
 'zones.gate': ['The Arc gate', "Every server passes here before it gets a rack. Its chip signs a quote, and a contract on Arc verifies Intel's signature on it (DCAP). Debug mode, missing security updates, unknown code or an old quote are refused. Machines are checked again about every 12 hours."],
 'zones.dish': ['Link to Arc', "Everything that matters is written on Arc: checks, payments, bonds and verdicts. Arc adds a block about every half second, and a payment is final in the block that holds it. The wall board counts Arc's blocks."],
 'zones.hive': ['Server hall', "Each cabinet is a slot where an operator can start an enclave, a sealed machine with its own key. Green ones passed Arc's check and can serve. Grey ones are history: their code was retired or their check expired. The red one was caught lying. Dark cabinets are free."],
 'zones.layers': ['Three layers from Arc', "The enclave registry lists every server that passed the gate. The product contract fixes each service's code fingerprint, price and revenue split, and changes wait out a delay. The operator's bond makes a proven lie cost money."],
 'zones.dock': ['Client counter', "Clients come here to use a service. The app checks the enclave's key on Arc, seals the request to it, and it travels to the rack. The signed answer comes back the same way. You pay per use in USDC, per call with x402 or from a prepaid session."],
 'zones.lab': ["The robot notary's lab", "For a Sealed Bounty, a protocol funds a pool. A hunter's exploit is replayed inside an enclave on a fork of Arc, and the hunter is paid in the same flow if the loss is real. Other operators can replay a claim to refute it within 3 days."],
 'zones.hive.fact': '15 machines registered on the first stack (v2.1) since 9 Nov, 5 live on 12 Nov',
 'legend.intro': 'The light bar on top of each cabinet shows its state. The colour of the module inside, and of the strip at its foot, shows which service it runs.',
 'legend.states': [['live', 'Live', 'Passed the gate on Arc and can serve.'], ['session', 'In a session', 'A client prepaid it, and it serves that client.'], ['checking', 'Being checked', 'Its quote is going through the Arc gate.'], ['fault', 'Caught lying', 'Its claim was refuted and its bond seized.'], ['retired', 'Retired', 'Its code was retired or its check expired.'], ['empty', 'Free cabinet', 'A dark cabinet: room for a new enclave.']],
 'legend.notes': ['In the tube, orange tickets are orders to start an enclave; blue envelopes are sealed requests, green ones signed answers.', 'Blue coins are USDC moving on Arc.', 'A light running to the wall board means a record was written on Arc.', 'The three layers over the racks glow when the registry, a product or a bond changes.', 'A gold seal on top of a cabinet: the verified level (chip and datacenter declared on Arc).'],
 'status.pods': '{live} racks live of {total}',
 'pod.title': 'Rack {short}', 'pod.statuses.empty': 'Empty slot',
 'pod.sealed': 'Nobody can look inside this machine, its owner included. Intel TDX encrypts its memory, and only its own key opens what clients send it.',
 'pod.liar': 'On 10 Nov this demo machine signed a false claim. Two other operators replayed it, the claim was refuted and its bond seized.',
 'events': {'register': 'Enclave {pod} started for {product}, checked by Arc', 'renew': 'Machine {pod} was checked again on Arc', 'image': 'Code fingerprint of machine {pod} recorded', 'machine_bound': 'Machine {pod} tied to its chip on Arc', 'invalidated': 'Machine {pod} retired, its code is no longer allowed', 'retired': 'Machine {pod} retired by its operator', 'expired': "Machine {pod}'s check expired", 'bond_reserved': 'Bond reserved for machine {pod}', 'bond_released': 'Bond released from machine {pod}', 'claim_refuted': "Two replays refuted machine {pod}'s claim"},
 'acts': {0: '9 Nov, the first stack (v2.1). The contracts are wired, the operator locks an 8 USDC bond and four products go live.', 1: 'Machines pass the gate, paid calls settle, a session runs and a hunter is paid 0.5 USDC for a real exploit.', 2: '10 Nov. A demo machine files a false claim. Two honest replays refute it and its 1 USDC bond is seized.', 3: "New code for three products, machines checked again, and the machine's datacenter declared on Arc by Proof of Cloud.", 4: '11 Nov. A Sealed Bounty that only verified machines may serve, with a 1 USDC pool.', 5: 'Since then, each live machine is checked again on Arc about every 12 hours.'},
 'acts.title.2': 'A lying machine is caught',
 # every act of the recorded history is the first stack's (v2.1): its title says so
 'acts.titles': {0: 'v2.1 · Network opens', 1: 'v2.1 · First paid work', 2: 'v2.1 · A lying machine is caught', 3: 'v2.1 · The verified level', 4: 'v2.1 · Product 7', 5: 'v2.1 · Steady state'},
 'about.paras': {0: "The recorded history is ArcHive's first stack, v2.1 (deployments.v21.testnet.json), read from its public API and the Arc explorer on 12 Nov 2026 at 23:40 UTC. Live, the room follows the v3 stack (deployments.v3.testnet.json, deployed on 19 Nov 2026).",
                 1: "The replay plays the first stack's 261 events, recorded on Arc between 9 and 12 Nov, in order and faster than real time, then the events the live API reports since. Idle hours are skipped. The ticker links each event to its transaction.",
                 2: "The page reads the live API (the v3 stack) and shows the network as it is now: the v3 racks light up, the first stack's stay as history. When the API cannot be reached, it shows the first stack's state of 12 Nov."},
 'about.last': "The clients, the technicians and the tube are a staging; every event in the ticker is a real transaction on Arc. 3D models: Kenney's Factory Kit, Space Station Kit, Furniture Kit, Mini Shop and Mini Characters (CC0); server racks: \u201cData center rack\u201d by Animase (NodeStar) on Sketchfab, Free Standard licence.",
 'legend.title': 'Reading the server room',
 'errors.models': 'The server room could not load its 3D models.',
 'extra': {
  'buttons': {'find': 'Find'},
  'zones': {'gate': {'title': 'The Arc gate', 'body': "New machines come in here. Arc reads the chip's identity (its PPID) inside Intel's signed certificate; for the verified level, the Proof of Cloud alliance must also have declared the machine's datacenter, and Arc checks that signature too. The enclaves started on the machine are then checked one by one at their cabinet.", 'fact': '1 machine at the verified level on the first stack (v2.1): chip 0x62d5…ce56, datacenter declared by Proof of Cloud on 10 Nov (Arc testnet)'}, 'noc': {'title': "The technician's desk", 'body': "An operator's technician works here. When a service needs an enclave, the order arrives through the tube; the technician takes that service's module from the shelf, slides it into a free cabinet and starts it. Arc then checks the enclave before it may serve.", 'fact': '15 enclaves started on the first stack (v2.1) since 9 Nov; 40 checks on Arc, renewals included (Arc testnet)'}},
  'speech': {'ask': '{service}, please!', 'thanks': 'Thanks!', 'start': 'Starting an enclave: {service}', 'publish': 'Product update on Arc'},
  'find': {'title': 'Find a rack or a transaction', 'placeholder': 'Key, operator, service or transaction hash', 'hint': 'The archive keeps every transaction the room has seen since 9 Nov, on both stacks ({n} so far; one transaction can hold several events).', 'racks': 'Racks', 'live': 'Racks in service', 'txs': 'Transactions', 'recent': 'Latest transactions', 'none': 'Nothing matches. Paste all or part of a key, an address or a transaction hash.'},
  'pod': {'history': 'History on Arc', 'historyCount': '{n} transactions', 'historyCount1': '1 transaction', 'stack': 'Stack', 'statuses': {'firstStack': 'First stack (v2.1)'}},
  # two stacks: the recorded history is the first stack (v2.1); the live room follows v3 (live.js)
  'stacks': {'first': '{name}, the first stack (from 9 Nov)', 'live': '{name}, the live stack (from 19 Nov)',
             'liveAct': {'title': 'The {name} stack', 'story': '19 Nov. The same contracts, deployed again as {name}. The two stacks run side by side until the switch; then {name} serves alone, and the {first} history stays as it happened.'}},
  'about': {'events': '{n} events', 'liveReplay': "The replay plays, in order, the events recorded on Arc since 9 Nov: the first stack's (v2.1), then from 19 Nov those of v3, which ran alongside it until the switch ({n} so far), faster than real time. Quiet hours are skipped. The ticker links each event to its transaction.", 'live': "Here the page reads ArcHive's API every 20 seconds, on the live stack (v3): a new key gets its rack, and each new event plays as it happens, stamped with the time of its block on Arc. The first stack's racks stay as history."},
  'toasts': {'liveNew': 'New on Arc: {n} events', 'liveNew1': 'New on Arc: 1 event',
             'skipNow': 'This is the network now, live. Replay its history with the replay button.'},
  # the total settled (sessions and paid calls), of which operators get 95 %: never "paid to operators"
  'status': {'paid': '{usdc} USDC settled', 'liveStack': 'live · {name} stack', 'stale': 'first stack (v2.1) · data from {time}'},
  'errors': {'noWebgl': "This device can't show the 3D room: WebGL is off or unavailable.",
             'noWebglLink': "See the same enclaves in the console's hive"},
  # the zones' facts read live from the API (the recorded facts date from 12 Nov), merged into 'zones' by apply()
  'zonesLive': {
   'pad': {'liveFact': '{bonded} USDC posted as bonds since 9 Nov, {slashed} USDC seized (live, Arc testnet)'},
   'hive': {'liveFact': '{enclaves} enclave keys registered on the {stack} stack, {active} live now'},
   'layers': {'liveFact': "Verdicts go to Circle's ERC-8004 registry on Arc: {verdicts} written so far"},
   'dock': {'fact': '5 paid calls and 1 session, 0.1494 USDC settled on the first stack (v2.1) by 12 Nov (team wallets, testnet prices)',
            'liveFact': '{calls} paid calls and {sessions} sessions, {settled} USDC settled so far (team wallets, testnet prices)'},
   'lab': {'liveFact': '{bountiesPaid} bounty paid ({bountyPaid} USDC), {refuted} lying claim refuted; {open} bounty open now, of {bounties}'},
   'noc': {'liveFact': '{enclaves} enclave keys registered on the {stack} stack, {active} live now (Arc testnet)'},
  },
 },
 'products.how': {'4': "The site's free copilot, running in its own enclave: it answers in the copilot panel of the site's pages.", '5': 'First stack only: a test bounty used on 10 Nov to show how a lying machine is caught.', '6': 'First stack only: replaced by product 7 on 11 Nov after a security fix.', '7': 'Only machines on a chip and datacenter verified on Arc may serve it (product 7 on the first stack, product 5 on v3).'},
}
FR = {
 'brand.tagline': 'des serveurs scellés, vérifiés et payés',
 'tour': [
  ["Bienvenue dans la salle des serveurs d'ArcHive", "Voici comment fonctionne ArcHive, raconté comme une salle des serveurs. Chaque baie est un casier où peut tourner une enclave, et chaque événement que vous verrez a eu lieu sur Arc testnet. Nous rejouons cette histoire en accéléré."],
  ['Au guichet, un client demande un service', "Une application ou une personne demande un service : une IA privée, un appel payé, une prime. Elle vérifie sur Arc la clé de l'enclave qui va la servir, puis scelle sa demande pour cette enclave seule. Elle paie à l'usage, en USDC."],
  ["La demande part à l'arrière, un technicien démarre une enclave", "La demande scellée voyage jusqu'à la salle des serveurs. Pour qu'un service existe, un opérateur démarre une enclave : le code exact du service entre dans une baie, une machine Intel TDX, et l'opérateur bloque une caution en USDC. Seule une enclave démarrée avec le code exact du produit est acceptée."],
  ['Dans une baie, même le propriétaire reste à la porte', "Intel TDX chiffre la mémoire du serveur, si bien que l'opérateur qui possède la machine ne peut pas lire ce qui tourne dedans. Ses clés naissent à l'intérieur, et Arc vérifie l'empreinte exacte de son code."],
  ["Trois couches descendent d'Arc", "Le matériel ne fait que la moitié du travail. Au-dessus des baies flottent trois registres tenus sur Arc : la liste des enclaves admises, le contrat du produit qui fixe code, prix et partage des revenus, et la caution qui rend le mensonge coûteux."],
  ['Arc vérifie chaque enclave', "La puce de chaque enclave signe une attestation : quel code tourne, sur quel processeur, à quel niveau de sécurité. Un contrat sur Arc vérifie lui-même la signature d'Intel. Mode debug, mises à jour manquantes, code inconnu ou attestation trop vieille : l'enclave ne sert personne. Les vérifications se répètent environ toutes les 12 heures."],
  ['Le notaire-robot refait le calcul', "Certains travaux se vérifient en les refaisant. L'exploit d'un chasseur est rejoué dans une enclave, sur une copie d'Arc, et payé seulement si la perte est réelle. Une machine prise à mentir perd sa caution, partagée entre celui qui la dénonce et la victime."],
  ["À vous d'explorer", "Cliquez sur une baie pour voir la vraie enclave qui s'y trouve et son historique sur Arc. La loupe retrouve n'importe quelle clé ou transaction. Rejouez l'histoire, allez voir la machine menteuse, ou ouvrez la console pour utiliser les services."],
 ],
 'zones.pad': ['Quai de livraison', "Les opérateurs livrent ici leurs machines. Chacune est un serveur Intel TDX que l'opérateur loue au réseau. Avant de gagner quoi que ce soit, l'opérateur bloque une caution en USDC, qu'un mensonge prouvé lui ferait perdre."],
 'zones.gate': ["Le portique d'Arc", "Chaque serveur passe ici avant d'avoir sa baie. Sa puce signe une attestation, et un contrat sur Arc vérifie la signature d'Intel (DCAP). Mode debug, mises à jour de sécurité manquantes, code inconnu ou attestation trop vieille : refusé. Les machines repassent environ toutes les 12 heures."],
 'zones.dish': ['Le lien avec Arc', "Tout ce qui compte est écrit sur Arc : vérifications, paiements, cautions et verdicts. Arc ajoute un bloc environ toutes les demi-secondes, et un paiement est définitif dans le bloc qui le contient. Le panneau mural compte les blocs d'Arc."],
 'zones.hive': ['La salle des baies', "Chaque baie est un casier où un opérateur peut démarrer une enclave, une machine scellée avec sa propre clé. Les vertes ont passé la vérification d'Arc et peuvent servir. Les grises appartiennent à l'histoire : leur code a été retiré ou leur vérification a expiré. La rouge a été prise à mentir. Les baies éteintes sont libres."],
 'zones.layers': ["Trois couches venues d'Arc", "Le registre des enclaves liste chaque serveur admis. Le contrat du produit fixe l'empreinte du code, le prix et le partage des revenus de chaque service, et tout changement attend un délai. La caution de l'opérateur fait payer un mensonge prouvé."],
 'zones.dock': ['Le guichet des clients', "Les clients viennent ici utiliser un service. L'application vérifie la clé de l'enclave sur Arc, scelle la requête pour elle, et la requête part vers la baie. La réponse signée revient par le même chemin. Vous payez à l'usage en USDC, à l'appel avec x402 ou depuis une session prépayée."],
 'zones.lab': ['Le labo du notaire-robot', "Pour une Prime scellée, un protocole finance une cagnotte. L'exploit d'un chasseur est rejoué dans une enclave, sur une copie d'Arc, et le chasseur est payé dans la foulée si la perte est réelle. D'autres opérateurs peuvent rejouer une réclamation pour la réfuter pendant 3 jours."],
 'zones.hive.fact': '15 machines inscrites sur la première pile (v2.1) depuis le 9 nov., 5 en service le 12 nov.',
 'legend.intro': "La barre lumineuse en haut de chaque baie montre son état. La couleur du module inséré, et de la bande à son pied, indique le service qu'elle fait tourner.",
 'legend.states': [['live', 'En service', "A passé le portique d'Arc et peut servir."], ['session', 'En session', 'Un client l\'a prépayée, et elle sert ce client.'], ['checking', 'En vérification', "Son attestation passe le portique d'Arc."], ['fault', 'Prise à mentir', 'Sa réclamation a été réfutée et sa caution saisie.'], ['retired', 'Retirée', 'Son code a été retiré ou sa vérification a expiré.'], ['empty', 'Baie libre', 'Une baie éteinte : de la place pour une nouvelle enclave.']],
 'legend.notes': ['Dans le tube, les tickets orange sont des ordres de démarrage ; les enveloppes bleues sont des requêtes scellées, les vertes des réponses signées.', 'Les pièces bleues sont des USDC qui circulent sur Arc.', 'Une lumière qui file vers le panneau mural signale un enregistrement sur Arc.', "Les trois couches au-dessus des baies s'allument quand le registre, un produit ou une caution change.", 'Un sceau doré sur une baie : le niveau vérifié (puce et datacenter déclarés sur Arc).'],
 'status.pods': '{live} baies en service sur {total}',
 'pod.title': 'Baie {short}', 'pod.statuses': {'live': 'En service', 'session': 'En session', 'checking': 'En vérification', 'fault': 'Prise à mentir', 'retired': 'Retirée', 'expired': 'Vérification expirée', 'empty': 'Emplacement vide'},
 'pod.sealed': "Personne ne peut regarder dans cette machine, pas même son propriétaire. Intel TDX chiffre sa mémoire, et seule sa clé ouvre ce que les clients lui envoient.",
 'pod.liar': "Le 10 nov., cette machine de démonstration a signé une fausse réclamation. Deux autres opérateurs l'ont rejouée, elle a été réfutée et sa caution saisie.",
 'events': {'register': "Enclave {pod} démarrée pour {product}, vérifiée par Arc", 'renew': 'La machine {pod} a été revérifiée sur Arc', 'image': 'Empreinte du code de la machine {pod} enregistrée', 'machine_bound': 'La machine {pod} est liée à sa puce sur Arc', 'invalidated': "Machine {pod} retirée, son code n'est plus autorisé", 'retired': 'Machine {pod} retirée par son opérateur', 'expired': 'La vérification de la machine {pod} a expiré', 'bond_reserved': 'Caution réservée pour la machine {pod}', 'bond_released': 'Caution libérée de la machine {pod}', 'claim_refuted': 'Deux rejeux ont réfuté la réclamation de la machine {pod}'},
 'acts': {0: '9 nov., la première pile (v2.1). Les contrats sont câblés, l\'opérateur bloque une caution de 8 USDC et quatre produits sont mis en service.', 1: 'Des machines passent le portique, des appels sont payés, une session tourne et un chasseur touche 0,5 USDC pour un vrai exploit.', 2: '10 nov. Une machine de démonstration dépose une fausse réclamation. Deux rejeux honnêtes la réfutent et sa caution de 1 USDC est saisie.', 3: 'Nouveau code pour trois produits, machines revérifiées, et le datacenter de la machine déclaré sur Arc par Proof of Cloud.', 4: '11 nov. Une Prime scellée que seules les machines vérifiées peuvent servir, avec une cagnotte de 1 USDC.', 5: 'Depuis, chaque machine en service est revérifiée sur Arc environ toutes les 12 heures.'},
 'acts.title.2': 'Une machine menteuse démasquée',
 'acts.titles': {0: 'v2.1 · Ouverture du réseau', 1: 'v2.1 · Premiers travaux payés', 2: 'v2.1 · Une machine menteuse démasquée', 3: 'v2.1 · Le niveau vérifié', 4: 'v2.1 · Produit 7', 5: 'v2.1 · Régime de croisière'},
 'about.paras': {0: "L'histoire enregistrée est la première pile d'ArcHive, v2.1 (deployments.v21.testnet.json), lue dans son API publique et l'explorateur d'Arc le 12 nov. 2026 à 23 h 40 UTC. En direct, la salle suit la pile v3 (deployments.v3.testnet.json, déployée le 19 nov. 2026).",
                 1: "Le rejeu joue les 261 événements de la première pile, inscrits sur Arc entre le 9 et le 12 nov., dans l'ordre et plus vite que le temps réel, puis ceux que l'API en direct donne depuis. Les heures creuses sont sautées. Le fil relie chaque événement à sa transaction.",
                 2: "La page lit l'API en direct (la pile v3) et montre le réseau tel qu'il est maintenant : les baies v3 s'allument, celles de la première pile restent comme histoire. Quand l'API est injoignable, elle montre l'état de la première pile au 12 nov."},
 'about.last': "Les clients, les techniciens et le tube sont une mise en scène ; chaque événement du fil est une vraie transaction sur Arc. Modèles 3D : Factory Kit, Space Station Kit, Furniture Kit, Mini Shop et Mini Characters de Kenney (CC0) ; baies : \u00ab Data center rack \u00bb d'Animase (NodeStar) sur Sketchfab, licence Free Standard.",
 'legend.title': 'Lire la salle des serveurs',
 'errors.models': "La salle des serveurs n'a pas pu charger ses modèles 3D.",
 'extra': {
  'buttons': {'find': 'Chercher'},
  'zones': {'gate': {'title': "Le portique d'Arc", 'body': "Les machines neuves entrent ici. Arc lit l'identité de leur puce (son PPID) dans le certificat signé d'Intel ; pour le niveau vérifié, l'alliance Proof of Cloud doit aussi avoir déclaré le datacenter de la machine, et Arc vérifie cette signature. Les enclaves démarrées sur la machine sont ensuite vérifiées une par une à leur baie.", 'fact': '1 machine au niveau vérifié sur la première pile (v2.1) : puce 0x62d5…ce56, datacenter déclaré par Proof of Cloud le 10 nov. (Arc testnet)'}, 'noc': {'title': 'Le poste du technicien', 'body': "Le technicien d'un opérateur travaille ici. Quand un service a besoin d'une enclave, l'ordre arrive par le tube ; le technicien prend le module de ce service sur l'étagère, le glisse dans une baie libre et la démarre. Arc vérifie ensuite l'enclave avant qu'elle puisse servir.", 'fact': '15 enclaves démarrées sur la première pile (v2.1) depuis le 9 nov. ; 40 vérifications sur Arc, renouvellements compris (Arc testnet)'}},
  'speech': {'ask': "{service}, s'il vous plaît !", 'thanks': 'Merci !', 'start': 'Je démarre une enclave : {service}', 'publish': 'Mise à jour du produit sur Arc'},
  'find': {'title': 'Chercher une baie ou une transaction', 'placeholder': 'Clé, opérateur, service ou hash de transaction', 'hint': 'Les archives gardent chaque transaction vue par la salle depuis le 9 nov., sur les deux piles ({n} à ce jour ; une transaction peut porter plusieurs événements).', 'racks': 'Baies', 'live': 'Baies en service', 'txs': 'Transactions', 'recent': 'Dernières transactions', 'none': "Aucun résultat. Collez tout ou partie d'une clé, d'une adresse ou d'un hash de transaction."},
  'pod': {'history': 'Historique sur Arc', 'historyCount': '{n} transactions', 'historyCount1': '1 transaction', 'stack': 'Pile', 'statuses': {'firstStack': 'Première pile (v2.1)'}},
  'stacks': {'first': '{name}, la première pile (depuis le 9 nov.)', 'live': '{name}, la pile en service (depuis le 19 nov.)',
             'liveAct': {'title': 'La pile {name}', 'story': "19 nov. Les mêmes contrats, redéployés en {name}. Les deux piles tournent côte à côte jusqu'à la bascule ; ensuite {name} sert seule, et l'histoire {first} reste telle qu'elle a eu lieu."}},
  'about': {'events': '{n} événements', 'liveReplay': "Le rejeu joue dans l'ordre les événements inscrits sur Arc depuis le 9 nov. : ceux de la première pile (v2.1), puis à partir du 19 nov. ceux de v3, qui a tourné à côté jusqu'à la bascule ({n} à ce jour), plus vite que le temps réel. Les heures creuses sont sautées. Le fil relie chaque événement à sa transaction.", 'live': "Ici, la page lit l'API d'ArcHive toutes les 20 secondes, sur la pile en service (v3) : une nouvelle clé reçoit sa baie, et chaque nouvel événement est joué dès qu'il arrive, à l'heure de son bloc sur Arc. Les baies de la première pile restent comme histoire."},
  'toasts': {'liveNew': 'Nouveau sur Arc : {n} événements', 'liveNew1': 'Nouveau sur Arc : 1 événement',
             'skipNow': "Voici le réseau maintenant, en direct. Rejouez son histoire avec le bouton de rejeu."},
  # the total settled, as in English: never "paid to operators"
  'status': {'paid': '{usdc} USDC réglés', 'liveStack': 'en direct · pile {name}', 'stale': 'première pile (v2.1) · données du {time}'},
  'errors': {'noWebgl': "Cet appareil ne peut pas afficher la salle en 3D : WebGL est coupé ou indisponible.",
             'noWebglLink': 'Voir les mêmes enclaves dans la ruche de la console'},
  # the zones' live facts, as in English
  'zonesLive': {
   'pad': {'liveFact': '{bonded} USDC de cautions déposées depuis le 9 nov., {slashed} USDC saisis (en direct, Arc testnet)'},
   'hive': {'liveFact': "{enclaves} clés d'enclave inscrites sur la pile {stack}, {active} en service maintenant"},
   'layers': {'liveFact': 'Les verdicts vont au registre ERC-8004 de Circle sur Arc : {verdicts} écrits à ce jour'},
   'dock': {'fact': "5 appels payés et 1 session, 0,1494 USDC réglés sur la première pile (v2.1) au 12 nov. (portefeuilles de l'équipe, prix de testnet)",
            'liveFact': "{calls} appels payés et {sessions} sessions, {settled} USDC réglés à ce jour (portefeuilles de l'équipe, prix de testnet)"},
   'lab': {'liveFact': '{bountiesPaid} prime payée ({bountyPaid} USDC), {refuted} réclamation mensongère réfutée ; {open} prime ouverte maintenant, sur {bounties}'},
   'noc': {'liveFact': "{enclaves} clés d'enclave inscrites sur la pile {stack}, {active} en service maintenant (Arc testnet)"},
  },
 },
 'products.how': {'4': "Le copilote gratuit du site, dans sa propre enclave : il répond dans le panneau du copilote des pages du site.", '5': 'Première pile seulement : une prime de test, utilisée le 10 nov. pour montrer comment une machine menteuse est démasquée.', '6': 'Première pile seulement : remplacée par le produit 7 le 11 nov. après un correctif de sécurité.', '7': 'Seules les machines sur une puce et un datacenter vérifiés sur Arc peuvent la servir (produit 7 sur la première pile, produit 5 sur v3).'},
}
def apply(L, P):
    d = c[L]
    d['brand']['tagline'] = P['brand.tagline']
    for i, (t, b) in enumerate(P['tour']): d['tour'][i] = {'title': t, 'body': b}
    for k in ['pad', 'gate', 'dish', 'hive', 'layers', 'dock', 'lab']:
        t, b = P['zones.' + k]; d['zones'][k]['title'] = t; d['zones'][k]['body'] = b
    d['zones']['hive']['fact'] = P['zones.hive.fact']
    d['legend']['intro'] = P['legend.intro']
    d['legend']['states'] = [{'key': k, 'label': l, 'hint': h} for k, l, h in P['legend.states']]
    d['legend']['notes'] = P['legend.notes']
    d['status']['pods'] = P['status.pods']
    d['pod']['title'] = P['pod.title']
    if 'pod.statuses' in P: d['pod']['statuses'] = P['pod.statuses']
    if 'pod.statuses.empty' in P: d['pod']['statuses']['empty'] = P['pod.statuses.empty']
    d['pod']['sealed'] = P['pod.sealed']; d['pod']['liar'] = P['pod.liar']
    d['events'].update(P['events'])
    for i, story in P['acts'].items(): d['acts'][i]['story'] = story
    d['acts'][2]['title'] = P['acts.title.2']
    for i, title in P.get('acts.titles', {}).items(): d['acts'][i]['title'] = title
    for i, para in P.get('about.paras', {}).items(): d['about']['paras'][i] = para
    d['about']['paras'][-1] = P['about.last']
    d['legend']['title'] = P['legend.title']
    d['errors']['models'] = P['errors.models']
    for k, how in P['products.how'].items(): d['products'][k]['how'] = how
    def merge(a, b):
        for k, v in b.items():
            if isinstance(v, dict): merge(a.setdefault(k, {}), v)
            else: a[k] = v
    extra = dict(P['extra'])
    live = extra.pop('zonesLive', {})
    merge(d, extra)
    merge(d['zones'], live)
apply('en', EN); apply('fr', FR)
json.dump(c, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('room copy written')
