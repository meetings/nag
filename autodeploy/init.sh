#!/bin/bash

npm config set prefix $PREFIX --global
npm install
npm link

install -m 0644 $DEPLOYDIR/$INTENT.conf /etc/init

service $INTENT start
