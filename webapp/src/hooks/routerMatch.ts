// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {useCurrentMatches, useParams} from '@solidjs/router'
import type {Accessor} from 'solid-js'

import type {RouterMatch} from '../utils'

// The match object react-router's useRouteMatch used to hand out — params plus
// the pattern the route was declared with — reconstructed from @solidjs/router.
// Utils.showBoard and the redirect pages fill the pattern with new params.
export function useRouteMatch(): Accessor<RouterMatch> {
    const params = useParams()
    const matches = useCurrentMatches()
    return () => ({
        params: {...params},
        path: matches()[matches().length - 1]?.route.originalPath ?? '',
    })
}
