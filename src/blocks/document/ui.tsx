import * as React from 'react'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as solidIcons from '@fortawesome/free-solid-svg-icons'
import { Menu } from '@headlessui/react'
import { Block, BlockRef, BlockUpdater, Environment } from '../../block'
import { LoadFileButton, getFullKey, saveFile, selectFile } from '../../ui/utils'
import { useAutoretrigger } from '../../ui/hooks'
import { DocumentState } from './model'
import * as Model from './model'

type Actions<State> = ReturnType<typeof ACTIONS<State>>

const ACTIONS = <State extends unknown>(
    update: BlockUpdater<DocumentState<State>>,
    innerBlock: Block<State>,
    env: Environment,
) => ({
    updateInner(action: (state: State) => State) {
        update((state: DocumentState<State>): DocumentState<State> => {
            const blockState = action(state.blockState)
            return {
                ...state,
                blockState,
                history: Model.reduceHistory([
                    ...state.history,
                    { type: 'state', time: new Date(), blockState },
                ]),
            }
        })
    },

    reset() {
        update(() => Model.init(innerBlock.init))
    },

    save() {
        update(state => {
            const content = JSON.stringify(Model.toJSON(state, innerBlock))
            saveFile(
                state.name + '.json',
                'application/json',
                content,
            )
            return state
        })
    },

    async loadLocalFile(file: File) {
        const content = JSON.parse(await file.text())
        try {
            const newState = Model.fromJSON(content, env, innerBlock)
            update(() => newState)
        }
        catch (e) {
            window.alert(`Could not load file: ${e}`)
        }
    },

    openHistory() {
        update(Model.openHistory)
    },
    
    closeHistory() {
        update(Model.closeHistory)
    },
    
    goBack() {
        update(Model.goBackInHistory)
    },
    
    goForward() {
        update(Model.goForwardInHistory)
    },
    
    useState() {
        update(state => Model.viewStateFromHistory(state, innerBlock, env))
    },
    
    changeName(name) {
        update(state => ({ ...state, name }))
    },
    
})


export interface DocumentUiProps<State> {
    state: DocumentState<State>
    update: (action: (state: DocumentState<State>) => DocumentState<State>) => void
    env: Environment
    innerBlock: Block<State>
    blockRef?: React.Ref<BlockRef> // not using ref because the <State> generic breaks with React.forwardRef
}

export function DocumentUi<State>({ state, update, env, innerBlock, blockRef }: DocumentUiProps<State>) {
    const containerRef = React.useRef<HTMLDivElement>()
    const innerRef = React.useRef<BlockRef>()
    React.useImperativeHandle(
        blockRef,
        () => ({
            focus() {
                containerRef.current?.focus()
            }
        })
    )

    React.useEffect(() => {
        innerRef.current?.focus()
    }, [])

    const actions = ACTIONS(update, innerBlock, env)

    function onKeyDown(event: React.KeyboardEvent) {
        switch (getFullKey(event)) {
            // not sure about capturing this...
            case "C-n":
                actions.reset()
                event.stopPropagation()
                event.preventDefault()
                return

            case "C-o":
                selectFile().then(file => {
                    actions.loadLocalFile(file)
                })
                event.stopPropagation()
                event.preventDefault()
                return

            case "C-s":
                actions.save()
                event.stopPropagation()
                event.preventDefault()
                return

            case "C-z":
                if (state.viewState.mode === 'history') {
                    actions.goBack()
                }
                else {
                    actions.openHistory()
                }
                event.stopPropagation()
                event.preventDefault()
                return

            case "C-y":
                if (state.viewState.mode === 'history') {
                    actions.goForward()
                    event.stopPropagation()
                    event.preventDefault()
                }
                return

            case "Escape":
                if (state.viewState.mode === 'history') {
                    actions.closeHistory()
                    event.stopPropagation()
                    event.preventDefault()
                }
                else if (document.activeElement !== containerRef.current) {
                    containerRef.current?.focus()
                    event.stopPropagation()
                    event.preventDefault()
                }
                return

            case "C-Enter":
                if (state.viewState.mode === 'history') {
                    actions.useState()
                    event.stopPropagation()
                    event.preventDefault()
                }
                return

            case "Enter":
                innerRef.current?.focus()
                event.stopPropagation()
                event.preventDefault()
                return
        }
    }

    function viewToplevelBlock() {
        switch (state.viewState.mode) {
            case 'current':
                
                return innerBlock.view({
                    ref: innerRef,
                    state: state.blockState,
                    update: actions.updateInner,
                    env: { ...env, history: state.history },
                })
            
            case 'history':
                const entryInHistory = state.history[state.viewState.position]
                if (entryInHistory === undefined) { return null }

                const stateInHistory = Model.getHistoryState(entryInHistory, innerBlock, env)
                return innerBlock.view({
                    state: stateInHistory,
                    update: () => {},
                    env: {
                        ...env,
                        history: state.history.slice(0, state.viewState.position)
                    },
                })
        }
    }

    return (
        <div ref={containerRef} className="min-h-full" tabIndex={-1} onKeyDown={onKeyDown}>
            <MenuBar
                state={state}
                actions={actions}
                />
            {viewToplevelBlock()}
        </div>
    )
}


interface MenuBarProps<State> {
    state: DocumentState<State>
    actions: Actions<State>
}

export function MenuBar<State>({ state, actions }: MenuBarProps<State>) {
    switch (state.viewState.mode) {
        case 'current':
            return (
                <div
                    className={`
                        relative z-10
                        bg-white backdrop-opacity-90 backdrop-blur
                        shadow mb-2 flex space-x-2 items-baseline
                    `}
                    >
                    <NormalMenuBar state={state} actions={actions} />

                    <div className="flex-1" />

                    <button
                        className={`
                            px-2 py-0.5 h-full
                            hover:text-blue-900 hover:bg-blue-200
                        `}
                        onClick={actions.openHistory}
                        >
                        <FontAwesomeIcon className="mr-1" size="xs" icon={solidIcons.faClockRotateLeft} />
                        History
                    </button>
                </div>
            )

        case 'history':
        default:
            return (
                <div
                    className={`
                        sticky top-0 left-0 right-0 z-10
                        bg-blue-100 text-blue-950 backdrop-opacity-90 backdrop-blur
                        shadow mb-2 flex space-x-2 items-baseline
                    `}
                    >
                    <HistoryModeMenuBar state={state} actions={actions} />

                    <button
                        className={`
                            px-2 py-0.5
                            text-blue-50 bg-blue-700 hover:bg-blue-500
                        `}
                        onClick={actions.closeHistory}
                        >
                        <FontAwesomeIcon className="mr-1" size="xs" icon={solidIcons.faClockRotateLeft} />
                        History
                    </button>
                </div>
            )
    }
}

function NormalMenuBar<State>({ state, actions }: MenuBarProps<State>) {
    if (state.viewState.mode !== 'current') {
        return null
    }

    return (
        <>
            <Menu as="div" className="relative">
                <Menu.Button as={React.Fragment}>
                    {({ open }) => (
                        <button
                            className={`
                                px-2 py-0.5 h-full
                                ${open ?
                                    "text-blue-50 bg-blue-500 hover:bg-blue-500"
                                :
                                    "hover:text-blue-950 hover:bg-blue-200"
                                }
                            `}>
                            File
                        </button>
                    )}
                </Menu.Button>
                <Menu.Items
                    className={`
                        absolute left-0 origin-top-left
                        w-56
                        flex flex-col
                        bg-white border rounded shadow
                        text-sm
                    `}
                    >
                    <Menu.Item>
                        {({ active }) => (
                            <button
                                className={`
                                    px-2 py-1 text-left
                                    ${active && "bg-blue-100"}
                                `}
                                onClick={actions.reset}
                                >
                                New File
                            </button>
                        )}
                    </Menu.Item>
                    <Menu.Item>
                        {({ active }) => (
                            <button
                                className={`
                                    px-2 py-1 text-left
                                    ${active && "bg-blue-100"}
                                `}
                                onClick={actions.save}
                                >
                                Save File
                            </button>
                        )}
                    </Menu.Item>
                    <Menu.Item>
                        {({ active }) => (
                            <LoadFileButton
                                className={`
                                    px-2 py-1 text-left
                                    ${active && "bg-blue-100"}
                                `}
                                onLoad={actions.loadLocalFile}
                                >
                                Load local File ...
                            </LoadFileButton>
                        )}
                    </Menu.Item>
                </Menu.Items>
            </Menu>
        </>
    )
}


function HistoryModeMenuBar<State>({ state, actions }: MenuBarProps<State>) {
    const [startGoBack, stopGoBack] = useAutoretrigger(actions.goBack)
    const [startGoForward, stopGoForward] = useAutoretrigger(actions.goForward)

    if (state.viewState.mode !== 'history') {
        return null
    }

    return (
        <>
            <button className="px-2 rounded hover:bg-blue-500 hover:text-blue-50" onClick={actions.useState}>
                Restore
            </button>
            <div className="flex-1 flex space-x-1 px-2">
                <button className="px-2 hover:text-blue-500" onMouseDown={startGoBack} onMouseUp={stopGoBack} onMouseLeave={stopGoBack}>
                    <FontAwesomeIcon icon={solidIcons.faAngleLeft} />
                </button>
                <button className="px-2 hover:text-blue-500" onMouseDown={startGoForward} onMouseUp={stopGoForward} onMouseLeave={stopGoBack}>
                    <FontAwesomeIcon icon={solidIcons.faAngleRight} />
                </button>
                <div className="self-center px-1">
                    {formatTime(state.history[state.viewState.position].time)}
                </div>
            </div>
        </>
    )
}


const secondInMs = 1000
const minuteInMs = 60 * secondInMs
const hourInMs = 60 * minuteInMs
const dayInMs = 24 * hourInMs

const formatTime = (date: Date) => {
    const diffInMs = Date.now() - date.getTime()
    if (diffInMs < dayInMs) {
        return Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
    }
    else {
        const formatOptions: Intl.DateTimeFormatOptions = {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }
        return Intl.DateTimeFormat(undefined, formatOptions).format(date)
    }
}