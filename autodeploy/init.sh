#!/bin/bash

npm config set prefix $PREFIX --global
npm install
npm link

install -m 0644 $DEPLOYDIR/$INTENT.conf /etc/init

# 1) Do some magic with encrypted configuration
# 2) Then start the service

exit 0
