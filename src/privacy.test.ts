import { describe, expect, it } from 'vitest'
import { createPrivacyTools } from './privacy'

describe('Privacy Mode aliases', () => {
  it('creates stable presentation aliases without preserving sensitive input', () => {
    const privacy = createPrivacyTools(true)
    const sensitive = {
      title: 'Private launch plan',
      path: '/Users/example/Projects/secret-client',
      id: '019f-sensitive-session',
      file: 'customers/priority-account.md',
      content: 'Connect to 192.168.1.42 as Example Person',
    }

    const rendered = [
      privacy.sessionTitle(sensitive.title, sensitive.id),
      privacy.path(sensitive.path),
      privacy.identifier(sensitive.id),
      privacy.file(sensitive.file),
      privacy.content(sensitive.content),
    ].join(' ')

    expect(privacy.sessionTitle(sensitive.title, sensitive.id)).toBe(
      privacy.sessionTitle(sensitive.title, sensitive.id),
    )
    expect(rendered).not.toContain('secret-client')
    expect(rendered).not.toContain('priority-account')
    expect(rendered).not.toContain('Example Person')
    expect(rendered).not.toContain('192.168.1.42')
    expect(rendered).not.toContain('/Users/')
  })

  it('keeps operational values unchanged when Privacy Mode is disabled', () => {
    const privacy = createPrivacyTools(false)
    expect(privacy.path('/tmp/project')).toBe('/tmp/project')
    expect(privacy.identifier('session-1')).toBe('session-1')
    expect(privacy.content('visible response')).toBe('visible response')
  })
})
