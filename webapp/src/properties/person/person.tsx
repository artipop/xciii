// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import {PropertyProps} from '../types'

import ConfirmPerson from './confirmPerson'

const Person = (props: PropertyProps): JSX.Element => {
    return (
        <ConfirmPerson
            {...props}
            showEmptyPlaceholder={true}
        />
    )
}

export default Person
