#!/bin/bash

. /etc/autodeploy.conf

git clean -f
git reset --hard HEAD
git checkout master
git pull

npm update 2>/dev/null && echo npm update done.

install -m 0644 $DEPLOYDIR/$INTENT.conf /etc/init

service $INTENT start

exit 0
