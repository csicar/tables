import React, { useEffect } from 'react'
import ReactDOM from 'react-dom'
import * as Babel from '@babel/core'
import BabelReact from '@babel/preset-react'
import { useCodeJar } from 'react-codejar'
import Prism from 'prismjs'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as solidIcons from '@fortawesome/free-solid-svg-icons'
import * as regularIcons from '@fortawesome/free-regular-svg-icons'
import { subUpdateArray, subUpdate, classed, nextElem } from './utils'

import 'prismjs/themes/prism.css'

/**************** Dynamic Code Execution **************/

const highlightJS = editor => {
    const text = editor.textContent
    editor.innerHTML = Prism.highlight(
        text,
        Prism.languages.javascript,
        'javascript'
    )
}

const runExpr = (code, env) => {
    if (!code) {
        return
    }
    try {
        // for error messages matching the user code, transform without the return first
        Babel.transform(code, { presets: [BabelReact] })

        const transformedCode = Babel.transform(
            `return (${code})`,
            {
                presets: [BabelReact],
                parserOpts: { allowReturnOutsideFunction: true },
            },
        ).code

        const exprFunc = new Function(
            ...Object.keys(env),
            transformedCode,
        )
        return exprFunc(...Object.values(env))
    }
    catch (e) {
        return e
    }
}


const CodeContent = classed('code')`
    block
    min-w-48 min-h-1
    rounded
    hover:bg-gray-100 focus:bg-gray-100
`


const CodeEditor = ({ code, onUpdate }) => {
    const ref = useCodeJar({
        code,
        onUpdate,
        highlight: highlightJS,
        options: {
            tab: "  ",
        },
    })

    return <pre><CodeContent ref={ref} /></pre>
}

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { caughtError: null }
    }

    static getDerivedStateFromError(error) {
        console.log("getDerivedStateFromError", error)
        return { caughtError: error }
    }

    componentDidCatch(error, errorInfo) {
        console.log("componentDidCatch", error, errorInfo)
    }

    render() {
        if (this.state.caughtError) {
            return (
                <React.Fragment>
                    <h3>An error occurred in your component</h3>
                    <h4>{this.state.caughtError.name}</h4>
                    <pre>{this.state.caughtError.message}</pre>
                </React.Fragment>
            )
        }

        return this.props.children
    }
}

const ValueView = ({ value }) => {
    // if (typeof value === 'function') {
    //     return (
    //         <ErrorBoundary>
    //             {React.createElement(value, null, null)}
    //         </ErrorBoundary>
    //     )
    // }
    /* else */ if (React.isValidElement(value)) {
        return <ErrorBoundary>{value}</ErrorBoundary>
    }
    else if (value instanceof Error) {
        return (
            <React.Fragment>
                <h3>{value.name}</h3>
                <pre>{value.message}</pre>
            </React.Fragment>
        )
    }
    else if (value && typeof value === 'object') {
        return <pre>{"{" + Object.keys(value).join(", ") + "}"}</pre>
    }
    else {
        return <pre>{value + ""}</pre>
    }
}

const REPL_MODES = ['both', 'result', 'code']
const REPL_ICON = {
    both: (
        <React.Fragment>
            <FontAwesomeIcon size="xs" icon={solidIcons.faCode} />
            <br />
            <FontAwesomeIcon size="xs" icon={solidIcons.faPlay} />
        </React.Fragment>
    ),
    result: <FontAwesomeIcon size="xs" icon={solidIcons.faPlay} />,
    code: <FontAwesomeIcon size="xs" icon={solidIcons.faCode} />,
}

const REPLLine = classed('div')`flex flex-row space-x-2`

const REPLContent = classed('div')`flex flex-col`

const REPLModeButton = classed('button')`
    text-slate-500
    hover:text-slate-600
    active:text-slate-700

    hover:bg-gray-200
    active:bg-gray-300

    transition-colors

    w-7
    leading-6

    rounded
`

const REPLMode = ({ mode, onUpdate }) =>
    <REPLModeButton
        onClick={() => onUpdate(nextElem(mode, REPL_MODES))}
    >
        {REPL_ICON[mode]}
    </REPLModeButton>


const TextInput = ({ value, onUpdate }) => {
    const ref = React.useRef(null)
    React.useEffect(() => {
        if (ref.current.innerText !== value) {
            ref.current.innerText = value
        }
    })
    const onInput = event => {
        onUpdate(event.target.innerText)
    }
    return <span contentEditable ref={ref} onInput={onInput} className="focus:bg-gray-100" />
}


const REPLDef = ({ def, onUpdate }) => {
    const [mode, setMode] = React.useState(REPL_MODES[0])

    const onUpdateExpr = expr => {
        onUpdate({ ...def, expr })
        setTimeout(() => {
            const result = runExpr(expr, { React })
            onUpdate(def => ({ ...def, result }))
        })
    }

    const onUpdateName = name => {
        onUpdate(def => ({ ...def, name: name.trim() }))
    }

    return (
        <REPLLine>
            <REPLMode mode={mode} onUpdate={setMode} />
            <REPLContent>
                <div><TextInput value={def.name} onUpdate={onUpdateName} /> =</div>
                {mode !== 'result' &&
                    <CodeEditor code={def.expr} onUpdate={onUpdateExpr} />
                }
                {mode !== 'code' &&
                    <ValueView value={def.result} />
                }
            </REPLContent>
        </REPLLine>
    )
}


const localEnv = env =>
    env.reduce((obj, def) => (obj[def.name] = def.result, obj), {})


const REPL = ({ code, onUpdate }) => {
    const [mode, setMode] = React.useState(REPL_MODES[0])

    const onUpdateExpr = expr => {
        onUpdate({ ...code, expr })
        setTimeout(() => {
            const result = runExpr(expr, { React, ...localEnv(code.env) })
            onUpdate(code => ({ ...code, result }))
        })
    }

    return (
        <div className="space-y-4">
            {code.env.map((def, idx) =>
                <REPLDef
                    key={idx}
                    def={def}
                    onUpdate={subUpdateArray(idx, subUpdate('env', onUpdate))}
                />
            )}
            <REPLLine>
                <REPLMode mode={mode} onUpdate={setMode} />
                <REPLContent>
                    {mode !== 'result' &&
                        <CodeEditor code={code.expr} onUpdate={onUpdateExpr} />
                    }
                    {mode !== 'code' &&
                        <ValueView value={code.result} />
                    }
                </REPLContent>
            </REPLLine>
        </div>
    )
}




/****************** Main Application ******************/

const StateEditor = ({ state, onUpdate }) => {
    const [stateJSON, setStateJSON] = React.useState(JSON.stringify(state, null, 2))
    const [validJSON, setValidJSON] = React.useState(true)

    useEffect(() => {
        try {
            onUpdate(JSON.parse(stateJSON))
            setValidJSON(true)
        }
        catch (e) {
            setValidJSON(false)
        }
    }, [stateJSON])

    return (
        <div>
            <CodeEditor code={stateJSON} onUpdate={setStateJSON} onRun={() => {}} />
            <p>{validJSON ? "saved" : "invalid JSON"}</p>
        </div>
    )
}

const APP_MODES = [ 'app', 'state' ]

const App = ({ state, onUpdate }) => {
    const [mode, setMode] = React.useState(APP_MODES[0])

    return (
        <React.Fragment>
            <button onClick={() => setMode(nextElem(mode, APP_MODES))}>{mode}</button>
            {mode === 'app' ?
                <ErrorBoundary>
                    <REPL
                        code={state.code}
                        onUpdate={subUpdate('code', onUpdate)}
                    />
                </ErrorBoundary>
            :
                <StateEditor state={state} onUpdate={onUpdate} />
            }
        </React.Fragment>
    )
}

let state = { code: "" }

try {
    const storedState = localStorage.getItem('state')
    if (storedState) {
        state = JSON.parse(storedState)
    }
} catch (e) {}

function updateStore() {
    localStorage.setItem('state', JSON.stringify(state))
    setTimeout(updateStore, 10 * 1000)
}

updateStore()

const container = document.getElementById("app")

function updateState(newState) {
    if (typeof newState === 'function') {
        state = newState(state)
    }
    else {
        state = newState
    }
    console.log('update', state)
    renderApp()
}

function renderApp() {
    ReactDOM.render(
        <App state={state} onUpdate={updateState} />,
        container,
    )
}

renderApp()