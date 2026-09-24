# Clean Hoobot export
#
# Tämä hakemisto on puhdas kopio Hoobot15:stä ilman:
# - node_modules / build
# - candlestore / simulation-data / logs
# - API-avaimia, Discord-tokeneita, lisenssejä
#
# Käyttöönotto:
#   1. npm install
#   2. copy settings\hoobot-options.json.example settings\hoobot-options.json
#   3. copy settings\hoobot-options-simulate.json.example settings\hoobot-options-simulate.json
#   4. täytä key/secret/token asetuksiin
#   5. npm run build:production
#
# Merge takaisin / toiseen repoon:
#   git remote add upstream <toinen-repo>
#   git fetch upstream
#   git merge upstream/main
#   (tai avaa PR GitHubissa)
