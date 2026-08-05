// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import {PropertyProps} from '../types'
import BaseTextEditor from '../baseTextEditor'

const Phone = (props: PropertyProps): JSX.Element => {
    return (
        <BaseTextEditor
            {...props}
            validator={() => true}
        />
    )
}
export default Phone
