// Where the preorder form sends what it collected. There is no backend in this
// repository: until one exists, the form falls back to opening a mail client
// with the same fields, so the page never silently loses a submission.
//
// Put a URL here (Formspree, a Cloudflare Worker, your own handler) and the form
// will POST JSON to it instead.
const PREORDER_ENDPOINT = ''
const PREORDER_EMAIL = 'hello@deffun.com'

// ---------------------------------------------------------------- the theme --
//
// Dark is the screen and the default, because the product is one. Which theme a
// visitor gets is decided by the inline script in index.html, before the first
// paint; here we only remember what they switch to.

const root = document.documentElement

document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    localStorage.setItem('deffun-theme', next)
})

// ------------------------------------------------------------- the preorder --

// The same script runs on the home page, which carries no form.
const form = document.getElementById('preorder')
const status = document.getElementById('form-status')

function say(text, state) {
    status.textContent = text
    status.dataset.state = state || 'ok'
}

form?.addEventListener('submit', async (event) => {
    event.preventDefault()

    const data = Object.fromEntries(new FormData(form).entries())
    if (!data.email || !data.email.includes('@')) {
        say('Проверьте адрес почты.', 'error')
        return
    }

    if (!PREORDER_ENDPOINT) {
        const body = [
            `Почта: ${data.email}`,
            `Имя: ${data.name || '—'}`,
            `Система: ${data.os}`,
        ].join('\n')
        window.location.href = `mailto:${PREORDER_EMAIL}` +
            `?subject=${encodeURIComponent('Предзаказ XCIII')}&body=${encodeURIComponent(body)}`
        say('Открыли почтовую программу — письмо заполнено, осталось отправить.')
        return
    }

    say('Отправляем…')
    try {
        const response = await fetch(PREORDER_ENDPOINT, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'application/json'},
            body: JSON.stringify(data),
        })
        if (!response.ok) {
            throw new Error(String(response.status))
        }
        form.reset()
        say('Записали. Напишем, когда откроются продажи.')
    } catch (e) {
        say(`Не отправилось. Напишите нам на ${PREORDER_EMAIL}, мы запишем вас вручную.`, 'error')
    }
})
