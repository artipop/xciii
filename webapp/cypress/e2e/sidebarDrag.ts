// Dragging a board into a category in the sidebar, which is the one thing the
// sidebar's drag and drop is for. It broke twice without a word: once when the
// drop's destination was read off the dragged item, which only moves under a
// dnd-kit plugin this application leaves out on purpose, and once when a
// category registered two drop targets under one id and the one that mattered
// was displaced by the other. Neither showed up in a unit test at the time,
// because neither is about a component -- both are about what the library does
// with real geometry and a real pointer.
//
// Like kanbanDrag.ts, the pointer is driven by cypress-real-events (CDP-level
// events, the only kind dnd-kit's sensor looks at) and its path is interpolated
// rather than jumped.

const STEPS = 14

function category(name: string) {
    return cy.contains('.SidebarCategory', name)
}

// `.subitem` and not `.SidebarBoardItem` alone: the active board's views are
// rows of the same class in the same category.
function boardsIn(name: string) {
    return category(name).find('.SidebarBoardItem.subitem')
}

// The pointer walks from the board to the target, expressed as an offset from
// the target's own centre, because the target is the one thing that stays put:
// the dragged board follows the pointer.
function dragBoardTo(board: JQuery, target: () => Cypress.Chainable<JQuery>) {
    const rect = board[0].getBoundingClientRect()
    const start = {x: Math.round(rect.left + (rect.width / 2)), y: Math.round(rect.top + (rect.height / 2))}

    target().then(($target) => {
        const targetRect = $target[0].getBoundingClientRect()
        const end = {
            x: Math.round(targetRect.left + (targetRect.width / 2)),
            y: Math.round(targetRect.top + (targetRect.height / 2)),
        }
        const dx = start.x - end.x
        const dy = start.y - end.y

        cy.wrap(board).realMouseDown({position: 'center'})
        for (let step = 1; step <= STEPS; step++) {
            const remaining = 1 - (step / STEPS)
            target().realMouseMove(Math.round(dx * remaining), Math.round(dy * remaining), {position: 'center'})
        }
        target().realMouseUp({position: 'center'})
    })
}

describe('Sidebar drag and drop', () => {
    beforeEach(() => {
        cy.apiUseSingleUserSession()
        cy.apiResetBoards()
        cy.apiGetMe().then((userID) => cy.apiSkipTour(userID))
    })

    it('moves a board into another category', () => {
        cy.visit('/')
        cy.uiCreateNewBoard('Dragged board')

        cy.log('**Create a category to drag it into**')
        category('Boards').find('.octo-sidebar-item.category .MenuWrapper button').click({force: true})
        cy.contains('Create New Category').click()
        cy.get('.categoryNameInput').type('Elsewhere')
        cy.get('.CreateCategoryModal').contains('button', 'Create').click()
        cy.get('.SidebarCategory').should('have.length', 2)

        // The new category holds nothing, so the board can only have landed
        // there by way of the category's own drop zone.
        const header = () => category('Elsewhere').find('.octo-sidebar-item.category').first()
        boardsIn('Elsewhere').should('have.length', 0)

        boardsIn('Boards').first().then(($board) => dragBoardTo($board, header))

        boardsIn('Elsewhere').should('have.length', 1)
        boardsIn('Elsewhere').first().should('contain.text', 'Dragged board')
        boardsIn('Boards').should('have.length', 0)

        cy.log('**And it stays there, rather than only looking as if it moved**')
        cy.reload()
        boardsIn('Elsewhere').should('have.length', 1)
    })
})
