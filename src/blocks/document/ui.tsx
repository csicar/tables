import * as React from 'react'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as solidIcons from '@fortawesome/free-solid-svg-icons'
import { Menu, Transition } from '@headlessui/react'

import { Block, BlockRef, BlockUpdater, Environment } from '../../block'
import * as block from '../../block'
import { LoadFileButton, saveFile, selectFile } from '../../ui/utils'
import { $update, arrayEquals, arrayStartsWith, clampTo, intersperse, nextElem } from '../../utils'
import { KeySymbol, KeyComposition, Keybinding, Keybindings, ShortcutSuggestions, useShortcuts, useBindingNotifications } from '../../ui/shortcuts'

import * as Model from './model'
import * as Pages from './pages'
import { CommandSearch } from './commands'
import { HistoryWrapper } from './history'
import * as History from './history'
import { Document, PageId, PageState } from './versioned'
import * as versioned from './versioned'

type Actions<State> = ReturnType<typeof ACTIONS<State>>

interface ActionProps<State> {
    state: Document<State>
    actions: Actions<State>
}

function ACTIONS<State extends unknown>(
    update: BlockUpdater<Document<State>>,
    updateHistory: BlockUpdater<HistoryWrapper<Document<State>>>,
    innerBlock: Block<State>,
    env: Environment,
) {
    const updatePages = block.fieldUpdater('pages', update)

    return {
        updateOpenPageInner(action: (state: State) => State) {
            update(inner =>
                Model.updateOpenPage(inner, action, innerBlock, env)
            )
        },


        reset() {
            update(() => Model.init(innerBlock.init))
        },

        save() {
            updateHistory(state => {
                const content = JSON.stringify(History.historyToJSON(state, inner => Model.toJSON(inner, innerBlock)), null, 2)
                saveFile(
                    'tables.json',
                    'application/json',
                    content,
                )
                return state
            })
        },

        async loadLocalFile(file: File) {
            const content = JSON.parse(await file.text())
            try {
                const newState = History.historyFromJSON(content, env, (json, env) => Model.fromJSON(json, update, env, innerBlock))
                updateHistory(() => newState)
            }
            catch (e) {
                window.alert(`Could not load file: ${e}`)
            }
        },

        async loadRemoteFile() {
            const url = window.prompt('Which URL should be loaded?')
            if (url === null) { return }

            try {
                const response = await fetch(url)
                const content = await response.json()
                const newState = History.historyFromJSON(content, env, (json, env) => Model.fromJSON(json, update, env, innerBlock))
                updateHistory(() => newState)
            }
            catch (e) {
                window.alert(`Could not load file from URL: ${e}`)
            }
        },

        useAsTempate(path: PageId[]) {
            update(inner => ({
                ...inner,
                template: Pages.getPageAt(path, inner.pages) ?? inner.template,
            }))
        },

        addPage(path: PageId[]) {
            update(inner =>
                Model.addPageAt(path, inner)
            )
        },

        deletePage(path: PageId[]) {
            update(inner =>
                Model.deletePageAt(path, inner, innerBlock, env, update)
            )
        },

        setPageName(path: PageId[], name: string) {
            update(innerState => {
                return {
                    ...innerState,
                    pages: Pages.updatePageAt(
                        path,
                        innerState.pages,
                        page => ({ ...page, name }),
                    ),
                }
            })
        },

        nestPage(path: PageId[]) {
            update(innerState => {
                const [newPath, pages] = Pages.nestPage(path, innerState.pages, env, innerBlock, updatePages)
                return {
                    ...innerState,
                    pages,
                    viewState: {
                        ...innerState.viewState,
                        openPage: newPath,
                    }
                }
            })
        },

        unnestPage(path: PageId[]) {
            update(innerState => {
                const [newPath, pages] = Pages.unnestPage(path, innerState.pages, env, innerBlock, updatePages)
                return {
                    ...innerState,
                    pages,
                    viewState: {
                        ...innerState.viewState,
                        openPage: newPath,
                    }
                }
            })
        },

        movePage(delta: number, path: PageId[]) {
            update(innerState => {
                return {
                    ...innerState,
                    pages: Pages.movePage(delta, path, innerState.pages, innerBlock, env, updatePages),
                }
            })
        },

        openPage(path: PageId[]) {
            update(inner =>
                Model.changeOpenPage(path, inner, env, innerBlock, update)
            )
        },

        openFirstChild(currentPath: PageId[]) {
            update(inner => {
                const parent = Pages.getPageAt(currentPath, inner.pages)
                if (parent === null || parent.children.length === 0) { return inner }

                const path = [...currentPath, parent.children[0].id]
                return Model.changeOpenPage(path, inner, env, innerBlock, update)
            })
        },

        openParent(currentPath: PageId[]) {
            if (currentPath.length > 1) {
                update(inner =>
                    Model.changeOpenPage(currentPath.slice(0, -1), inner, env, innerBlock, update)
                )
            }
        },

        openNextPage(currentPath: PageId[]) {
            update(state => {
                const allPaths = Pages.getExpandedPaths(state.pages, currentPath)
                const openPageIndex = allPaths.findIndex(somePath => arrayEquals(somePath, currentPath))
                const nextPageIndex = clampTo(0, allPaths.length, openPageIndex + 1)

                const newPath = allPaths[nextPageIndex]
                return Model.changeOpenPage(newPath, state, env, innerBlock, update)
            })
        },

        openPrevPage(currentPath: PageId[]) {
            update(state => {
                const allPaths = Pages.getExpandedPaths(state.pages, currentPath)
                const openPageIndex = allPaths.findIndex(somePath => arrayEquals(somePath, currentPath))
                const prevPageIndex = clampTo(0, allPaths.length, openPageIndex - 1)

                const newPath = allPaths[prevPageIndex]
                return Model.changeOpenPage(newPath, state, env, innerBlock, update)
            })
        },

        toggleCollapsed(path: PageId[]) {
            update(state => {
                return {
                    ...state,
                    pages: Pages.updatePageAt(
                        path,
                        state.pages,
                        page => ({ ...page, isCollapsed: !page.isCollapsed }),
                    ),
                }
            })
        },

        toggleSidebar() {
            update(state =>
                $update(open => !open, state,'viewState','sidebarOpen')
            )
        },

    }
}


interface LocalActions {
    setIsNameEditing(editing: boolean): void
    toggleShortcutsVisible(): void
    toggleSearch(): void
}

const commandSearchBinding = (localActions: LocalActions): Keybinding => [
    ["C-K", "C-Shift-P"],
    "none",
    "search commands",
    () => { localActions.toggleSearch() },
]

function DocumentKeyBindings<State>(
    state: Document<State>,
    actions: Actions<State>,
    containerRef: React.MutableRefObject<HTMLDivElement>,
    innerRef: React.MutableRefObject<BlockRef>,
    localActions: LocalActions,
): Keybindings {
    return [
        {
            description: "create / delete pages",
            bindings: [
                [
                    // not sure about capturing this...
                    ["C-N"],
                    "!inputFocused",
                    "new page",
                    () => {
                        actions.addPage(state.viewState.openPage.slice(0, -1))
                        localActions.setIsNameEditing(true)
                    },
                ],
                [
                    ["C-Shift-N"],
                    "none",
                    "new child page",
                    () => {
                        actions.addPage(state.viewState.openPage)
                        localActions.setIsNameEditing(true)
                    },
                ],
                [
                    ["C-Backspace"],
                    "selfFocused",
                    "delete page",
                    () => { actions.deletePage(state.viewState.openPage) },
                ],
            ]
        },
        {
            description: "move pages",
            bindings: [
                [
                    ["C-Shift-K", "C-Shift-ArrowUp"],
                    "selfFocused",
                    "move page up",
                    () => { actions.movePage(-1, state.viewState.openPage) },
                ],
                [
                    ["C-Shift-J", "C-Shift-ArrowDown"],
                    "selfFocused",
                    "move page down",
                    () => { actions.movePage(1, state.viewState.openPage) },
                ],
                [
                    ["C-Shift-H", "C-Shift-ArrowLeft"],
                    "selfFocused",
                    "move page one level up",
                    () => { actions.unnestPage(state.viewState.openPage) },
                ],
                [
                    ["C-Shift-L", "C-Shift-ArrowRight"],
                    "selfFocused",
                    "move page one level down",
                    () => { actions.nestPage(state.viewState.openPage) },
                ],
            ]
        },
        {
            description: "move between pages",
            bindings: [
                [
                    ["K", "ArrowUp"],
                    "selfFocused",
                    "open prev page",
                    () => { actions.openPrevPage(state.viewState.openPage) },
                ],
                [
                    ["J", "ArrowDown"],
                    "selfFocused",
                    "open next page",
                    () => { actions.openNextPage(state.viewState.openPage) },
                ],
                [
                    ["L", "ArrowRight"],
                    "selfFocused",
                    "open first child page",
                    () => { actions.openFirstChild(state.viewState.openPage) },
                ],
                [
                    ["H", "ArrowLeft"],
                    "selfFocused",
                    "open parent page",
                    () => { actions.openParent(state.viewState.openPage) },
                ],
            ]
        },
        {
            description: "change page",
            bindings: [
                [
                    ["C-Shift-R"],
                    "selfFocused",
                    "edit page name",
                    () => { localActions.setIsNameEditing(true) },
                ],
                [
                    ["Space"],
                    "selfFocused",
                    "toggle page collapsed",
                    () => { actions.toggleCollapsed(state.viewState.openPage) },
                ],
                [
                    ["C-Shift-D"],
                    "none",
                    "safe as default template",
                    () => { actions.useAsTempate(state.viewState.openPage) },
                ],
            ]
        },
        {
            description: "files",
            bindings: [
                [
                    ["C-O"],
                    "none",
                    "open local file",
                    async () => { actions.loadLocalFile(await selectFile()) },
                ],
                [
                    ["C-S"],
                    "none",
                    "save file",
                    () => { actions.save() },
                ],
            ]
        },
        {
            description: "view",
            bindings: [
                commandSearchBinding(localActions),
                [
                    ["C-B"],
                    "none",
                    "toggle sidebar",
                    () => { actions.toggleSidebar() },
                ],
                [
                    ["Escape"],
                    "!selfFocused",
                    "focus sidebar",
                    () => { containerRef.current?.focus() },
                ],
                [
                    ["Enter"],
                    "selfFocused",
                    "focus page content",
                    () => { innerRef.current?.focus() },
                ],
            ]
        },
        {
            description: "help",
            bindings: [
                [
                    ["C-?"],
                    "none",
                    "toggle shortcut suggestions",
                    () => { localActions.toggleShortcutsVisible() },
                ]
            ]
        }
    ]
}


export interface DocumentUiProps<State> {
    state: Document<State>
    update: BlockUpdater<Document<State>>
    updateHistory: BlockUpdater<HistoryWrapper<Document<State>>>
    env: Environment
    innerBlock: Block<State>
    blockRef?: React.Ref<BlockRef> // not using ref because the <State> generic breaks with React.forwardRef
}

type ShortcutsViewMode = 'hidden' | 'flat' | 'full'
const SHORTCUTS_VIEW_MODES: ShortcutsViewMode[] = ['full', 'flat', 'hidden']

export function DocumentUi<State>({ state, update, env, updateHistory, innerBlock, blockRef }: DocumentUiProps<State>) {
    const containerRef = React.useRef<HTMLDivElement>()
    const mainScrollRef = React.useRef<HTMLDivElement>()
    const innerRef = React.useRef<BlockRef>()
    React.useImperativeHandle(
        blockRef,
        () => ({
            focus() {
                containerRef.current?.focus()
            }
        })
    )
    const [isNameEditing, setIsNameEditing] = React.useState(false)
    const [isSelfFocused, setIsSelfFocused] = React.useState(false)
    const [shortcutsViewMode, setShortcutsViewMode] = React.useState<ShortcutsViewMode>('hidden')
    const [search, setSearch] = React.useState<Keybindings>()

    const { getBindings } = useBindingNotifications()

    const localActions: LocalActions = React.useMemo(() => ({
        setIsNameEditing,

        toggleShortcutsVisible() {
            setShortcutsViewMode(mode => nextElem(mode, SHORTCUTS_VIEW_MODES))
        },

        toggleSearch() {
            setSearch(bindings => (
                bindings === undefined ?
                    getBindings()
                :
                    undefined
            ))
        },
    }), [])

    const actions = React.useMemo(
        () => ACTIONS(update, updateHistory, innerBlock, env),
        [update, updateHistory, innerBlock, env],
    )
    const bindings = DocumentKeyBindings(state, actions, containerRef, innerRef, localActions)
    const bindingProps = useShortcuts(bindings)

    const onFocus = React.useCallback((ev: React.FocusEvent) => {
        if (ev.target === ev.currentTarget) {
            setIsSelfFocused(true)
        }
        bindingProps.onFocus(ev)
    }, [bindingProps.onFocus])

    const onBlur = React.useCallback((ev: React.FocusEvent) => {
        if (ev.target === ev.currentTarget) {
            setIsSelfFocused(false)
        }
        bindingProps.onBlur(ev)
    }, [bindingProps.onBlur])


    React.useEffect(() => {
        mainScrollRef.current && mainScrollRef.current.scroll({ top: 0, behavior: 'instant' })
    }, [state.viewState.openPage])


    const sidebarVisible = isSelfFocused || state.viewState.sidebarOpen || isNameEditing

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            {...bindingProps}
            onFocus={onFocus}
            onBlur={onBlur}
            className="group/document-ui relative h-full w-full overflow-hidden outline-none"
            >
            <Sidebar
                state={state}
                actions={actions}
                isVisible={sidebarVisible}
                isNameEditing={isNameEditing}
                setIsNameEditing={setIsNameEditing}
                commandBinding={commandSearchBinding(localActions)}
                />
            <SidebarButton sidebarVisible={sidebarVisible} toggleSidebar={actions.toggleSidebar} />

            <div
                className={`
                    h-full
                    transition-all ${sidebarVisible ? "ml-56" : ""}
                    flex flex-col items-stretch overflow-hidden
                    bg-gray-50
                `}
            >
                <div ref={mainScrollRef} className="flex-1 overflow-y-auto transition-all">
                    <MainView
                        key={state.viewState.openPage.join('.')}
                        innerRef={innerRef}
                        state={state}
                        actions={actions}
                        innerBlock={innerBlock}
                        env={env}
                        sidebarVisible={sidebarVisible}
                        />
                </div>
                {shortcutsViewMode !== 'hidden' &&
                    <div className="flex flex-row w-full overflow-hidden items-end space-x-1 border-t-2 border-gray-100">
                        <div
                            className={`
                                flex-1 flex flex-row justify-between
                                ${shortcutsViewMode === 'flat' ? "space-x-8" : "space-x-20"}
                                px-10 py-1 overflow-x-auto
                            `}
                        >
                            <ShortcutSuggestions flat={shortcutsViewMode === 'flat'} />
                        </div>
                        <button
                            className={`
                                ${shortcutsViewMode !== 'flat' && 'absolute bottom-0 right-0'}
                                px-1 bg-gray-100 opacity-50 hover:opacity-100 transition rounded
                            `}
                            onClick={localActions.toggleShortcutsVisible}
                        >
                            <FontAwesomeIcon icon={solidIcons.faCaretDown} />
                        </button>
                    </div>
                }
                {shortcutsViewMode === 'hidden' &&
                    <button
                        className={`
                            absolute bottom-3 right-3 w-8 h-8
                            rounded-full border border-gray-100 shadow
                            bg-transparent opacity-50 hover:opacity-100 hover:bg-white transition
                            flex justify-center items-center
                            text-sm
                        `}
                        onClick={localActions.toggleShortcutsVisible}
                    >
                        ⌘
                    </button>
                }
                {search !== undefined && <CommandSearch bindings={search} close={() => setSearch(undefined) } />}
            </div>
        </div>
    )
}

interface MainViewProps<State> {
    innerRef: React.Ref<BlockRef>
    actions: Actions<State>
    state: Document<State>
    innerBlock: Block<State>
    env: Environment
    sidebarVisible: boolean
}

function MainView<State>({
    innerRef,
    actions,
    state,
    innerBlock,
    env,
    sidebarVisible,
}: MainViewProps<State>) {
    const openPage = Model.getOpenPage(state)
    const noOpenPage = openPage === null
    // don't include `state` as a dependency, because:
    //   - `Model.getOpenPageEnv` only needs `state` for Pages before the current `openPage`
    //   - only the current `openPage` can change (and following pages as they depend on it, but they are irrelevant for this case)
    //   - so the real dependency, the Pages before `openPage`, can only change if one of them becomes the `openPage`
    //   - so `innerState.viewState.openPage` suffices as dependency
    //   - otherwise `pageEnv` would change every time something in `openPage` changes
    //      => which leads to everything in `openPage` being reevaluated, even though just some subset could suffice
    // This could be better solved, if I could break innerState up into the pages before and only feed them as argument and dependency.
    // But currently it looks like this would harm seperation of concerns. It seems that the inner workings of `Model.getOpenPageEnv`
    // therefore would have to spill into here.
    const pageEnv = React.useMemo(
        () => noOpenPage ? null : Model.getOpenPageEnv(state, env, innerBlock),
        [state.viewState.openPage, noOpenPage, env, innerBlock],
    )

    if (!pageEnv) {
        function Link({ onClick, children }) {
            return <a className="font-medium cursor-pointer text-blue-800 hover:text-blue-600" onClick={onClick}>{children}</a>
        }
        return (
            <div className="h-full w-full flex justify-center items-center">
                <div className="text-center text-lg text-gray-900">
                    <Link onClick={() => actions.addPage([])}>
                        Add new Page
                    </Link><br />
                    or select one from the{' '}
                    {state.viewState.sidebarOpen ?
                        "Sidebar"
                    :
                        <Link onClick={actions.toggleSidebar}>
                            Sidebar
                        </Link>
                    }
                </div>
            </div>
        )
    }

    return (
        <div className={`mb-[80cqh] bg-white relative ${sidebarVisible ? "px-1" : "px-10"}`}>
            <Breadcrumbs openPage={state.viewState.openPage} pages={state.pages} onOpenPage={actions.openPage} />
            {innerBlock.view({
                ref: innerRef,
                state: openPage.state,
                update: actions.updateOpenPageInner,
                env: pageEnv,
            })}
        </div>
    )
}

interface BreadcrumbsProps {
    openPage: PageId[]
    pages: PageState<unknown>[]
    onOpenPage(path: PageId[]): void
}

function Breadcrumbs({ openPage, pages, onOpenPage }: BreadcrumbsProps) {
    function pathToPages(path: PageId[], pages: PageState<unknown>[], currentPath: PageId[] = []) {
        if (path.length === 0) { return [] }

        const page = pages.find(p => p.id === path[0])
        if (!page) { return pathToPages(path.slice(1), pages) }

        return [
            [ currentPath, page, pages ],
            ...pathToPages(path.slice(1), page.children, [ ...currentPath, page.id ])
        ]
    }

    const pathPages = pathToPages(openPage, pages)

    return (
        <div className="flex flex-row py-2 -ml-1 text-gray-800 text-sm">
            {pathPages.map(([path, page, siblings]) => (
                <React.Fragment key={path.join('.')}>
                    <Menu as="div" className="relative">
                        <Menu.Button className="rounded px-1.5 -mx-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200">
                            <FontAwesomeIcon size="xs" icon={solidIcons.faAngleRight} />
                        </Menu.Button>
                        {siblingsMenuItems(siblings, path)}
                    </Menu>
                    <button
                        className="rounded px-1.5 -mx-0.5 hover:bg-gray-200"
                        onClick={() => { onOpenPage([ ...path, page.id ]) }}
                    >
                        {versioned.getName(page)}
                    </button>
                </React.Fragment>
            ))}
        </div>
    )

    function siblingsMenuItems(siblings: PageState<unknown>[], path: PageId[]) {
        return (
            <Menu.Items
                className={`
                    absolute -top-1 -right-1 translate-x-full z-10
                    flex flex-col items-stretch whitespace-nowrap
                    rounded bg-white shadow
                    focus:outline-none overflow-hidden
                `}
            >
                {siblings.map(page => (
                    <Menu.Item key={page.id}>
                        {({ active }) => {
                            const pathHere = [...path, page.id]
                            const isOpen = arrayStartsWith(pathHere, openPage)
                            return (
                                <button
                                    className={`
                                        px-2 py-1 hover:bg-gray-200
                                        ${isOpen && "bg-gray-100"} ${active && "bg-gray-200"}
                                        text-left
                                    `}
                                    onClick={() => { onOpenPage(pathHere) } }
                                >
                                    {versioned.getName(page)}
                                </button>
                            )
                        }}
                    </Menu.Item>
                ))}
            </Menu.Items>
        )
    }
}


function SidebarButton<State>({ sidebarVisible, toggleSidebar }: { sidebarVisible: boolean, toggleSidebar(): void }) {
    if (sidebarVisible) {
        return null
    }

    return (
        <div className="absolute top-1 left-2 z-10">
            <button className="text-gray-300 hover:text-gray-500 transition" onClick={toggleSidebar}>
                <FontAwesomeIcon icon={solidIcons.faBars} />
            </button>
        </div>
    )
}



interface SidebarProps<State> extends ActionProps<State> {
    isVisible: boolean
    isNameEditing: boolean
    setIsNameEditing: (editing: boolean) => void
    commandBinding: Keybinding
}

function Sidebar<State>({ state, actions, isVisible, isNameEditing, setIsNameEditing, commandBinding }: SidebarProps<State>) {
    function CommandSearchButton() {
        return (
            <div
                className={`
                    rounded-full mx-2 px-3 py-0.5
                    flex flex-row items-baseline space-x-2
                    bg-gray-200 text-gray-400 border border-gray-300 
                    text-sm cursor-pointer
                    hover:bg-gray-100 hover:text-gray-900 hover:border-gray-400
                    transition
                    group
                `}
                onClick={() => commandBinding[3]()}
            >
                <FontAwesomeIcon className="text-gray-600 self-center" size="sm" icon={solidIcons.faMagnifyingGlass} />
                <span>Commands</span>
                <div className="flex-1 text-right">
                    {intersperse<React.ReactNode>(
                        "/",
                        commandBinding[0].map(k => <KeyComposition key={k} shortcut={k} Key={KeySymbol} />)
                    )}
                </div>
            </div>
        )
    }

    return (
        <Transition
            show={isVisible}
            className="absolute inset-y-0 h-full left-0 flex flex-col space-y-1 whitespace-nowrap overflow-auto bg-gray-100 w-56"
            enter="transition-transform"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition-transform"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
        >
            <button
                className={`
                    px-2 py-0.5 self-end text-gray-400
                    hover:text-gray-800 hover:bg-gray-200
                `}
                onClick={actions.toggleSidebar}
                >
                <FontAwesomeIcon icon={solidIcons.faAnglesLeft} />
            </button>

            <CommandSearchButton />

            <div className="h-3" />

            <SidebarMenu state={state} actions={actions} />

            <hr />

            {state.pages.map(page => (
                <Pages.PageEntry
                    key={page.id}
                    page={page}
                    openPage={state.viewState.openPage}
                    actions={actions}
                    isNameEditing={isNameEditing}
                    setIsNameEditing={setIsNameEditing}
                    />
            ))}
            <button
                className="px-2 py-0.5 w-full text-left text-xs text-gray-400 hover:text-blue-700"
                onClick={() => actions.addPage([])}
                >
                <span className="inline-block px-0.5 w-6">
                    <FontAwesomeIcon icon={solidIcons.faPlus} />{' '}
                </span>
                Add Page
            </button>
        </Transition>
    )
}




function SidebarMenu<State>({ actions }: ActionProps<State>) {
    type MenuItemProps<Elem extends React.ElementType> =
        React.ComponentPropsWithoutRef<Elem>
        & { as?: Elem }

    function MenuItem<Elem extends React.ElementType = 'button'>(
        props: MenuItemProps<Elem>
    ) {
        const { as: Element = 'button', children = null, ...restProps } = props
        return (
            <Menu.Item>
                {({ active }) => (
                    <Element className={`px-2 py-1 text-left ${active && "bg-blue-200"}`} {...restProps}>
                        {children}
                    </Element>
                )}
            </Menu.Item>
        )
    }

    return (
        <Menu as="div">
            <Menu.Button as={React.Fragment}>
                {({ open }) => (
                    <button
                        className={`
                            px-2 py-0.5 w-full text-left
                            ring-0 ring-blue-500 focus:ring-1
                            ${open ?
                                "text-blue-50 bg-blue-500 hover:bg-blue-500"
                            :
                                "hover:text-blue-950 hover:bg-blue-200"}
                        `}
                    >
                        File
                    </button>
                )}
            </Menu.Button>

            <Menu.Items className="w-full flex flex-col bg-gray-200 text-sm">
                <MenuItem onClick={actions.reset}>
                    New File
                </MenuItem>
                <MenuItem onClick={actions.save}>
                    Save File
                </MenuItem>
                <MenuItem as={LoadFileButton} onLoad={actions.loadLocalFile}>
                    Load local File ...
                </MenuItem>
                <MenuItem onClick={actions.loadRemoteFile}>
                    Load File from URL ...
                </MenuItem>
            </Menu.Items>
        </Menu>
    )
}
