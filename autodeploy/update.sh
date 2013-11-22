#!/bin/bash
# update.sh, 2013-11-22 Tuomas Starck / Meetin.gs
#
# Autodeployment (version 2) update hook for
# generic Node.js service upgrading.

set -u

. $DEPLOYDIR/stage1.sh

git_upgrade && {
    echo " *** update: Version has not changed, exiting"
    exit 0
}

. $DEPLOYDIR/stage2.sh

acquire_lock && {
    echo " *** update: Lock acquired, trying to update"
    npm update 2> /dev/null

    echo " *** update: Installing service configuration"
    install -m 0644 -p $DEPLOYDIR/$INTENT.conf /etc/init/

    echo " *** update: Updating version"
    git rev-parse HEAD | tee $VERSIONFILE

    echo " *** update: Restarting service"
    service $INTENT restart

    release_lock
}
