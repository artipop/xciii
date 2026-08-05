// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The redirect that used to transform pre-routing query params (?id=&v=&c=)
// into routes. The logic has been commented out since before the Solid port;
// the component stays as the mount point should it ever come back.
const BackwardCompatibilityQueryParamsRedirect = (): null => {
    return null
}

export default BackwardCompatibilityQueryParamsRedirect
