#!/bin/bash
# Remove dependancies and make sure the publish directory and zip does not exist.
rm -rf ../hoobot-latest/
rm -rf ../hoobot-latest.zip
# rm -rf package-lock.json 
# rm -rf node_modules/
# Install and build the project.
npm install
npm run build
# Change out of project dir to create publish dir and move required files for publish.
mkdir ../hoobot-latest
mkdir ../hoobot-latest/settings
mkdir ../hoobot-latest/logs
cp ./settings/hoobot-options.json.example ../hoobot-latest/settings/hoobot-options.json.example
cp ./settings/hoobot-options-simulate.json.example ../hoobot-latest/settings/hoobot-options-simulate.json.example
cp ./alarm2.mp3 ../hoobot-latest/alarm2.mp3
cp ./alarm.mp3 ../hoobot-latest/alarm.mp3
cp ./hoobot.service ../hoobot-latest/hoobot.service
cp ./linux.sh ../hoobot-latest/linux.sh
cp ./osx.sh ../hoobot-latest/osx.sh
cp ./package.json ../hoobot-latest/package.json
cp ./README.md ../hoobot-latest/README.md
cp ./windows.bat ../hoobot-latest/windows.bat
cp -r ./build ../hoobot-latest/build
cd ..
# Zip the publish folder for delivery
zip -r hoobot-latest.zip hoobot-latest/
# Delete the publish folder as it's not needed anymore
rm -rf hoobot-latest/
# Now move the zip to servers for users.


