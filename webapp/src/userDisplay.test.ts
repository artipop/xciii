import {createIntl} from './intl'
import {IUser} from './user'
import {SINGLE_USER_ID, personName, personNameById} from './userDisplay'

const intl = createIntl({locale: 'en', messages: {}})

const user = (id: string, username: string): IUser => ({
    id,
    username,
    email: '',
    nickname: '',
    firstname: '',
    lastname: '',
    props: {},
    create_at: 0,
    update_at: 0,
    is_bot: false,
    is_guest: false,
    roles: '',
})

describe('userDisplay', () => {
    // On an install of one person there is no account and no name: the API
    // synthesizes the session, and the page is the only half that knows which
    // language to say «Вы» in.
    it('calls the person at the machine "You" while they have no account', () => {
        expect(personName(intl, user(SINGLE_USER_ID, 'anything'), 'username')).toBe('You')
        expect(personNameById(intl, SINGLE_USER_ID, {})).toBe('You')
    })

    // Turning team mode on registers that person under the same id, so that
    // their boards stay theirs (docs/teamwork.md) — and from then on «Вы» is
    // wrong twice: they picked a username, and everybody else would read it as
    // being about themselves.
    it('calls them by the name they picked once the install is a team', () => {
        const owner = user(SINGLE_USER_ID, 'artem')
        expect(personName(intl, owner, 'username', true)).toBe('artem')
        expect(personNameById(intl, SINGLE_USER_ID, {[SINGLE_USER_ID]: owner}, 'username', true)).toBe('artem')
    })

    // Everybody else has always had a real username: a teammate, an agent's
    // account, a source's.
    it('leaves every other account alone in both modes', () => {
        const agent = user('agent-id', 'клаус')
        expect(personName(intl, agent, 'username')).toBe('клаус')
        expect(personName(intl, agent, 'username', true)).toBe('клаус')
    })

    // A group header on a board whose members have not arrived yet: printing
    // the raw id is how "single-user" ended up on screen.
    it('falls back to the id it was given for an unknown account', () => {
        expect(personNameById(intl, 'nobody-here', {})).toBe('nobody-here')
    })
})
