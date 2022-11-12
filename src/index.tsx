import * as React from 'react'
import ReactDOM from 'react-dom/client'

import 'prismjs/themes/prism.css'

import { CommandBlock, CommandModel } from './blocks/command'
import { ErrorBoundary, ErrorInspector } from './ui/value'
import { library } from './utils/std-library'
import { ErrorView } from './ui/utils'
import { useThrottle } from './ui/hooks'
import { DocumentBlock, DocumentState } from './blocks/document'


const blocks = library.blocks

type ToplevelBlockState = DocumentState<CommandModel>
const ToplevelBlock = DocumentBlock(CommandBlock('', null, blocks.StateEditor(blocks), blocks))


/****************** Main Application ******************/

const loadSavedState = (): ToplevelBlockState => {
    debugger
    try {
            const savedJson = JSON.parse(localStorage.getItem('block'))
            return ToplevelBlock.fromJSON(savedJson, library)
    }
    catch (e) {
        console.warn("Could not load saved state:", e)

        const backupName = `block-backup-${Date.now()}`
        console.log("Saving backup of saved state under", backupName)
        localStorage.setItem(backupName, localStorage.getItem('block'))

        return ToplevelBlock.init
    }
}

const App = () => {
    const [state, setState] = React.useState<ToplevelBlockState>(loadSavedState)
    const [updateError, setUpdateError] = React.useState<null | Error>(null)
    const [savingError, setSavingError] = React.useState<null | Error>(null)

    const persistStateAndHistory = useThrottle(5000, (state: ToplevelBlockState) => {
        try {
            const stateAsJson = ToplevelBlock.toJSON(state)
            localStorage.setItem('block', JSON.stringify(stateAsJson))
        }
        catch (error) { setSavingError(error) }
    })

    React.useEffect(() => {
        persistStateAndHistory(state)
    }, [state])

    const safeUpdate = action => {
        setState(state => {
            try {
                return action(state)
            }
            catch (error) {
                setUpdateError(error)
                return state
            }
        })
    }

    const viewToplevelBlock = () => {
        return ToplevelBlock.view({
            state: state,
            update: safeUpdate,
            env: library,
        })
    }

    return (
        <React.Fragment>
            <ViewInternalError
                title="Could not save current state"
                error={savingError}
                onDismiss={() => setSavingError(null)}
            />
            <ViewInternalError
                title="Last action could not be completed"
                error={updateError}
                onDismiss={() => setUpdateError(null)}
            />
            <ErrorBoundary title="There was an Error in the Toplevel Block">
                {viewToplevelBlock()}
            </ErrorBoundary>
        </React.Fragment>
    )
}



const ViewInternalError = ({ title, error, onDismiss }) => {
    if (error === null) { return null }

    return (
        <ErrorView title={"Internal Error: " + title} error={error} className="sticky top-1 my-1 z-20 shadow-lg">
            <button onClick={onDismiss}>Dismiss</button>
            <ErrorInspector error={error} />
        </ErrorView>
    )
}




/*** Script ***/

const root = ReactDOM.createRoot(document.getElementById('app'))
root.render(<App />)