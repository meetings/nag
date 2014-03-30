#!/bin/bash

. $DEPLOYDIR/githupdate.sh

git_upgrade && [ "$FORCE" != "yes" ] && {
    echo Version has not changed, exiting
    exit 0
}

npm update

install -m 0644 $DEPLOYDIR/$INTENT.conf /etc/init

service $INTENT restart

echo Githupdate done
