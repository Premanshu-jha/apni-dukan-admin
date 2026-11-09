import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { PincodeInput } from './PincodeInput'

function Harness({ start = [] as string[], coveredBy = {} as Record<string, string[]> }) {
  const [value, setValue] = useState(start)
  const [draft, setDraft] = useState('')
  return (
    <form onSubmit={() => { throw new Error('the form must not be submitted by Enter in the pincode box') }}>
      <PincodeInput id="p" value={value} onChange={setValue} draft={draft} onDraft={setDraft} coveredBy={coveredBy} />
    </form>
  )
}

describe('PincodeInput', () => {
  it('adds a typed pincode with Add or Enter, like a to-do list, and removes it with ×', async () => {
    render(<Harness coveredBy={{ '201309': ['Ravi Field'] }} />)
    const box = screen.getByLabelText('Pincodes they cover')
    const add = screen.getByRole('button', { name: 'Add pincode' })
    expect(add).toBeDisabled()
    await userEvent.type(box, '5000')
    expect(add).toBeDisabled()
    await userEvent.type(box, '72')
    await userEvent.click(add)
    expect(box).toHaveValue('')
    await userEvent.type(box, '201309{Enter}')
    const chips = screen.getByRole('list', { name: 'Pincodes added' })
    expect(chips).toHaveTextContent('500072')
    expect(chips).toHaveTextContent('also covered by Ravi Field')
    expect(screen.getByText('2 pincodes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove 500072' }))
    expect(chips).not.toHaveTextContent('500072')
    expect(box).toHaveFocus()   // the keyboard stays in the box
    expect(screen.getByText('1 pincode')).toBeInTheDocument()
  })

  it('blocks letters and a 7th digit, and Enter with an incomplete pincode adds nothing', async () => {
    render(<Harness />)
    const box = screen.getByLabelText('Pincodes they cover')
    await userEvent.type(box, 'ab5000721')
    expect(box).toHaveValue('500072')
    await userEvent.clear(box)
    await userEvent.type(box, '5000{Enter}')
    expect(screen.queryByRole('list', { name: 'Pincodes added' })).toBeNull()
  })

  it('a pasted list adds every valid one, names the invalid ones, and lights up a duplicate instead of adding it', async () => {
    render(<Harness start={['500072']} />)
    const box = screen.getByLabelText('Pincodes they cover')
    box.focus()
    await userEvent.paste('500085, 500072 012345')
    const chips = screen.getByRole('list', { name: 'Pincodes added' })
    expect(chips.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByText(/"012345" isn't a valid pincode/)).toBeInTheDocument()
    expect(chips.querySelector('[data-flash]')).toHaveTextContent('500072')
  })
})
