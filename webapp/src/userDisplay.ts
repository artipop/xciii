import {IntlShape} from './intl'
import {IUser} from './user'
import {Utils} from './utils'

// The one name on these screens nobody chose.
//
// The person using a desktop install has no account: the API synthesizes a user
// for the session on every request (server/api/users.go), so its username is a
// constant on the Go side — and a constant cannot be in the language the page
// happens to be read in. It is resolved here instead, where the language is
// known, so «Вы» and "You" are the same fact in two catalogues rather than one
// Russian word shipped to every reader.
//
// The id is what everything else checks, and it stays the identity: this is the
// display half and nothing branches on it.
export const SINGLE_USER_ID = 'single-user'

// personName is the name to print for a user. The local user is the exception;
// everybody else — a person on a shared install, an agent's account, a source's
// — has a real username somebody picked.
export function personName(intl: IntlShape, user: IUser, nameFormat: string): string {
    if (user.id === SINGLE_USER_ID) {
        return youName(intl)
    }
    return Utils.getUserDisplayName(user, nameFormat)
}

// personNameById is the same answer where only an id is at hand and the user
// may not have been loaded — a group header on a board whose members list has
// not arrived yet. Without this the raw id was printed, which is where
// "single-user" showed up on screen.
export function personNameById(intl: IntlShape, id: string, users: {[key: string]: IUser}, nameFormat = 'username'): string {
    const user = users[id]
    if (user) {
        return personName(intl, user, nameFormat)
    }
    return id === SINGLE_USER_ID ? youName(intl) : id
}

function youName(intl: IntlShape): string {
    return intl.formatMessage({id: 'User.you', defaultMessage: 'You'})
}
