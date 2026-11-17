import { createContext, useContext } from 'react'

// Which project the reviewer has chosen, shared by every analysis screen, so choosing one project is enough to look at it on
// every screen. Outside the provider (the tests of the individual screens) each screen keeps its own choice.
export const ProjectChoiceContext = createContext(null) // { id, setId } or null
export const useProjectChoice = () => useContext(ProjectChoiceContext)
