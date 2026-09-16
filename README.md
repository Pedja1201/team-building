# Evidencija prijava

## Online hosting (Sites)

Za online sajt koristi se `hosting/worker.mjs` i trajna D1 baza. Izgled stranica
i API `/api/registrations` ostaju isti; Python server ostaje dostupan za lokalni rad.
Online prijave se ne upisuju u lokalni `registrations.sqlite3`, pa ih lokalni
program `registrations_gui.py` ne prikazuje. Online baza se pregleda na `/admin`,
uz prijavu vlasnikovim ChatGPT nalogom. Pregled ima pretragu, stranice od po 50
prijava, osvežavanje i CSV izvoz svih prijava za Excel. Spisak i CSV proveravaju
dozvolu na serveru. Dozvoljeni email je tajna `ADMIN_EMAIL` u Sites podešavanjima.

Tri postoje?e lokalne prijave prenete su u online bazu. Duplikati su spojeni
bez obzira na velika/mala slova, uz ranije vreme prve prijave. Privremeni
pristup za prenos uklonjen je iz koda. Lokalni SQLite fajl ostaje sa?uvan kao
kopija i ne sinhronizuje se automatski.

Priprema: `npm ci`, `npm test`, `npm run build`.
Promene šeme: izmeniti `db/schema.ts`, zatim `npm run db:generate`.
SQL migracije u `drizzle/` primenjuju se pri objavljivanju.
Build uključuje javne stranice, zaštićeni admin pregled i slike; lokalna baza i Python alati
nisu deo javnih datoteka. Lozinke se ne šalju niti čuvaju, a email poruke se ne
šalju automatski.

## Lokalni rad

Potreban je Python 3. Pokrenite `python server.py` iz ovog foldera i otvorite
http://localhost:8000. Otvaranje HTML fajlova direktno ili preko Live Server-a
ne pokreće API za čuvanje prijava.

`login.html` (Login page) šalje samo email adresu. Lozinka se nikada ne šalje.
SQLite baza `registrations.sqlite3` kreira se pri prvom pokretanju servera.
Tabela `registrations` sadrži email i vreme prve prijave u UTC; ponovljene
prijave istom adresom ne prave duplikate. Bazu možete otvoriti SQLite alatom
i izvršiti `SELECT email, registered_at FROM registrations ORDER BY registered_at DESC;`.
Baza nije dostupna preko HTTP-a. Server nema javni endpoint za spisak prijava.

## Grafički pregled prijava

Na Windows-u dvokliknite `Pregled prijava.bat`, ili iz terminala pokrenite
`python registrations_gui.py`. Otvara se lokalni prozor sa email adresama,
vremenom prve prijave u UTC i ukupnim brojem prijava. Polje za pretragu filtrira
email adrese; dugme **Osveži** ili taster **F5** učitava nove prijave iz baze.
Pregled samo čita bazu i može biti otvoren dok server radi. Za pregled postojeće
baze nije potrebno pokretati server. Koristi Tkinter koji dolazi uz standardnu
Python instalaciju za Windows.

Server je namenjen lokalnom radu. Za pristup sa drugih računara potrebno je
postaviti backend na hosting sa HTTPS-om i ograničiti pristup bazi.
Email poruke se ne šalju automatski; tekst o uputstvima je samo potvrda na stranici.
