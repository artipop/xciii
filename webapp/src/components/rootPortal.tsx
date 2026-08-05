// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Portal} from 'solid-js/web'
import type {ParentComponent} from 'solid-js'

// Renders into #xciii-root-portal — the node index.html provides above
// the app root, which is what keeps dialogs over everything else.
const RootPortal: ParentComponent = (props) => {
    const rootPortal = document.getElementById('xciii-root-portal')

    return (
        <Portal mount={rootPortal || document.body}>
            {props.children}
        </Portal>
    )
}

export default RootPortal
