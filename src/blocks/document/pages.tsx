import * as React from 'react'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as solidIcons from '@fortawesome/free-solid-svg-icons'
import * as regularIcons from '@fortawesome/free-regular-svg-icons'

import { Block, BlockUpdater, Environment, mapWithEnv } from '../../block'
import * as Multiple from '../../block/multiple'

import { arrayEquals, arrayStartsWith, clampTo } from '../../utils'
import { getFullKey } from '../../ui/utils'
import { PageId, PageState, getDefaultName, getName } from './versioned'


export function init<State>(id: PageId, initState: State): PageState<State> {
    return {
        id,
        name: '',
        state: initState,
        isCollapsed: true,
        children: [],
    }
}

export function toEnv<State>(page: PageState<State>, innerBlock: Block<State>) {
    return { [getName(page)]: innerBlock.getResult(page.state) }
}

export function getPageAt<State>(path: PageId[], pages: Array<PageState<State>>) {
    if (path.length === 0) { return null }

    const page = pages.find(page => page.id === path[0])
    if (page === undefined) { return null }
    if (path.length === 1) { return page }

    return getPageAt(path.slice(1), page.children)
}

export function getAllPaths(pages: PageState<unknown>[]): Array<PageId[]> {
    return pages.flatMap(page => [
        [page.id],
        ...getAllPaths(page.children).map(path => [page.id, ...path]),
    ])
}

export function getExpandedPaths(pages: PageState<unknown>[], currentPath: PageId[] = []): Array<PageId[]> {
    return pages.flatMap(page => {
        const isInPath = page.id === currentPath[0]
        const childPath = isInPath ? currentPath.slice(1) : []
        const areChildrenVisible = !page.isCollapsed || childPath.length > 0
        const childPaths = (
            areChildrenVisible ?
                getExpandedPaths(page.children, childPath)
            :
                []
        )
        return [
            [page.id],
            ...childPaths.map(path => [page.id, ...path]),
        ]
    })
}

export function getSiblingsOf<State>(
    path: PageId[],
    pages: Array<PageState<State>>
): [ PageState<State>[], PageState<State>[] ] {
    const siblings = (
        path.length <= 1 ?
            pages
        :
            getPageAt(path.slice(0, -1), pages)
                .children
    )

    const selfId = path.slice(-1)[0] ?? -1
    const selfIndex = Math.min(Number.MAX_SAFE_INTEGER, siblings.findIndex(page => page.id === selfId))
    const siblingsBefore = siblings.slice(0, selfIndex)
    const siblingsAfter = siblings.slice(selfIndex + 1)
    
    return [siblingsBefore, siblingsAfter]
}

export function getNextDependentPath<State>(
    path: PageId[],
    pages: PageState<State>[],
) {
    const parentPath = path.slice(-1)
    const [_siblingsBefore, siblingsAfter] = getSiblingsOf(path, pages)
    if (siblingsAfter.length === 0) {
        return parentPath
    }
    return [ ...parentPath, siblingsAfter[0].id ]
}

export function getSiblingsEnv<State>(siblings: PageState<State>[], env: Environment, innerBlock: Block<State>) {
    return Object.assign(
        {},
        env,
        ...siblings.map(sibling =>
            toEnv(sibling, innerBlock)
        )
    )
}

export function getPageEnvAt<State>(
    path: PageId[],
    pages: PageState<State>[],
    env: Environment,
    innerBlock: Block<State>,
) {
    const [siblingsBefore, _siblingsAfter] = getSiblingsOf(path, pages)
    const page = getPageAt(path, pages)
    const siblingsEnv = getSiblingsEnv(siblingsBefore, env, innerBlock)
    const childrenEnv = getSiblingsEnv(page.children, siblingsEnv, innerBlock)
    
    return childrenEnv
}


export function unnestPage<State>(
    path: PageId[],
    pages: PageState<State>[],
    env: Environment,
    innerBlock: Block<State>,
    updatePagesState: BlockUpdater<PageState<State>[]>,
): [PageId[], PageState<State>[]] {
    if (path.length <= 1) { return [path, pages] }

    const pageToMove = getPageAt(path, pages)
    if (pageToMove === null) { return [path, pages] }

    const newParentPath = path.slice(0, -2)
    const currentParentPath = path.slice(0, -1)
    const currentParentId = currentParentPath.slice(-1)[0]
    const pageToMoveId = path.slice(-1)[0]

    let newPath = path
    let recomputePath = path
    const newPages = updatePageSiblings(
        pages,
        (path, siblings) => {
            if (arrayEquals(path, currentParentPath)) {
                const pageToMoveIndex = siblings.findIndex(sibling => sibling.id === pageToMoveId)
                if (pageToMoveIndex >= siblings.length - 1) {
                    // if we're the last sibling, start recomputing the parent
                    recomputePath = path.slice(0, -1)
                }
                else {
                    const siblingAfter = siblings[pageToMoveIndex + 1]
                    recomputePath = [ ...currentParentPath, siblingAfter.id ]
                }
                return [
                    ...siblings.slice(0, pageToMoveIndex),
                    ...siblings.slice(pageToMoveIndex + 1),
                ]
            }
            if (arrayEquals(path, newParentPath)) {
                const index = siblings.findIndex(page => page.id === currentParentId)
                const newId = Multiple.nextFreeId(siblings)
                const newPageToMove = { ...pageToMove, id: newId }
                newPath = [...newParentPath, newId]
                return [
                    ...siblings.slice(0, index + 1),
                    newPageToMove,
                    ...siblings.slice(index + 1),
                ]
            }
            return siblings
        },
    )

    return [
        newPath,
        recomputePagesFrom(
            recomputePath,
            newPages,
            env,
            innerBlock,
            updatePagesState,
        ),
    ]
}

export function nestPage<State>(
    path: PageId[],
    pages: PageState<State>[],
    env: Environment,
    innerBlock: Block<State>,
    updatePagesState: BlockUpdater<PageState<State>[]>,
): [PageId[], PageState<State>[]] {
    if (path.length === 0) { return [path, pages] }

    const pageToMove = getPageAt(path, pages)
    if (pageToMove === null) { return [path, pages] }

    const parentPath = path.slice(0, -1)
    const childId = path.slice(-1)[0]

    let newPath = path
    const newPages = updatePageSiblingsAt(
        parentPath,
        pages,
        siblings => {
            const childIndex = siblings.findIndex(page => page.id === childId)
            if (childIndex === 0) { return siblings }
            
            const child = siblings[childIndex]
            const newParent = siblings[childIndex - 1]

            const newChild = { ...child, id: Multiple.nextFreeId(newParent.children) }

            newPath = [...parentPath, newParent.id, newChild.id ]
            
            return [
                ...siblings.slice(0, childIndex - 1),
                {
                    ...newParent,
                    children: [ ...newParent.children, newChild ],
                },
                ...siblings.slice(childIndex + 1),
            ]
        },
    )

    return [
        newPath,
        recomputePagesFrom(
            newPath,
            newPages,
            env,
            innerBlock,
            updatePagesState,
        ),
    ]
}

export function movePage<State>(
    delta: number,
    path: PageId[],
    pages: PageState<State>[],
    innerBlock: Block<State>,
    env: Environment,
    updatePagesState: BlockUpdater<PageState<State>[]>,
) {
    if (path.length === 0) { return pages }

    const parentPath = path.slice(0, -1)
    const childId = path.slice(-1)[0]
    let recomputePath = path

    function moveSibling(id: PageId, siblings: PageState<State>[]) {
        const index = siblings.findIndex(page => page.id === id)
        if (index < 0) { return siblings }
        const pageToMove = siblings[index]

        const newIndex = clampTo(0, siblings.length, index + delta)
        const siblingsWithout = siblings.filter(page => page.id !== pageToMove.id)

        if (delta < 0) {
            if (index === siblings.length - 1) {
                recomputePath = parentPath
            }
            else {
                const siblingAfterPageToMove = siblings[index + 1]
                recomputePath = [ ...parentPath, siblingAfterPageToMove.id ]
            }
        }

        const newSiblings = [
            ...siblingsWithout.slice(0, newIndex),
            pageToMove,
            ...siblingsWithout.slice(newIndex),
        ]
        return newSiblings
    }

    return recomputePagesFrom(
        recomputePath,
        updatePageSiblingsAt(
            parentPath,
            pages,
            siblings => moveSibling(childId, siblings),
        ),
        env,
        innerBlock,
        updatePagesState,
    )
}

export function updatePageSiblings<State>(
    siblings: PageState<State>[],
    update: (parentPath: PageId[], siblings: PageState<State>[]) => PageState<State>[],
    currentPath: PageId[] = [],
) {
    const newSiblings = update(currentPath, siblings)
    return newSiblings.map(page => {
        const pathHere = [...currentPath, page.id]
        const children = updatePageSiblings(page.children, update, pathHere)
        return { ...page, children }
    })
}

export function updatePageSiblingsAt<State>(
    parentPath: PageId[],
    siblings: PageState<State>[],
    update: (siblings: PageState<State>[]) => PageState<State>[],
) {
    return updatePageSiblings(
        siblings,
        (path, siblings) => {
            if (!arrayEquals(path, parentPath)) {
                return siblings
            }
            return update(siblings)
        },
    )
}

export function updatePages<State>(
    pages: Array<PageState<State>>,
    update: (path: PageId[], page: PageState<State>) => PageState<State>,
    currentPath: PageId[] = [],
) {
    return pages.map(
        page => {
            const pathHere = [...currentPath, page.id]
            const children = updatePages(page.children, update, pathHere)
            return update(pathHere, { ...page, children })
        }
    )
}

export function updatePageStateAt<State>(
    path: PageId[],
    updatePagesState: BlockUpdater<PageState<State>[]>,
    action: (state: State) => State,
    env: Environment,
    innerBlock: Block<State>,
) {
    updatePagesState(pages =>
        recomputePagesFrom(
            path,
            updatePageAt(path, pages, page => ({ ...page, state: action(page.state) })),
            env,
            innerBlock,
            updatePagesState,
        )
    )
}

export function recomputePagesFrom<State>(
    pathWithChanges: null | PageId[],
    pages: PageState<State>[],
    env: Environment,
    innerBlock: Block<State>,
    updatePagesState: BlockUpdater<PageState<State>[]>,
    currentPath: PageId[] = [],
) {
    const recomputeStartIndex = (
        pathWithChanges === null ?
            0
        : pathWithChanges.length === 0 ?
            // pages are the children of the changed page -- they don't need to be recalculated
            pages.length
        : pathWithChanges.length === 1 ?
            // don't recalculate the page that changed
            1 + pages.findIndex(page => page.id === pathWithChanges[0])
        :
            pages.findIndex(page => page.id === pathWithChanges[0])
    )

    const unaffectedPages = pages.slice(0, recomputeStartIndex)
    const affectedPages = pages.slice(recomputeStartIndex)

    const affectedPagesEnv = getSiblingsEnv(unaffectedPages, env, innerBlock)

    const updatedPages = mapWithEnv(
        affectedPages,
        (page, localEnv) => {
            function localUpdate(action: (state: State) => State) {
                updatePageStateAt(pathHere, updatePagesState, action, env, innerBlock)
            }

            const pathHere = [...currentPath, page.id]
            const children = recomputePagesFrom(
                pathWithChanges?.slice(1) ?? null,
                page.children,
                localEnv,
                innerBlock,
                updatePagesState,
                pathHere,
            )
            const localEnvWithChildren = getSiblingsEnv(children, localEnv, innerBlock)
            const state = innerBlock.recompute(page.state, localUpdate, localEnvWithChildren)

            const newPage = {
                ...page,
                children,
                state,
            }

            return {
                out: newPage,
                env: toEnv(newPage, innerBlock),
            }
        },
        affectedPagesEnv,
    )

    return [...unaffectedPages, ...updatedPages]
}

export function updatePageAt<State>(
    path: PageId[],
    pages: PageState<State>[],
    action: (state: PageState<State>) => PageState<State>,
) {
    if (path.length === 0) { return pages }

    return (
        updatePages(
            pages,
            (currentPath, page) => {
                if (arrayEquals(currentPath, path)) {
                    return action(page)
                }
                return page
            },
        )
    )
}





export interface PageActions {
    addPage(path: PageId[]): void
    setPageName(path: PageId[], name: string): void
    openPage(path: PageId[]): void
    toggleCollapsed(path: PageId[]): void
    deletePage(path: PageId[]): void
}

export interface PageEntryProps<State> {
    page: PageState<State>
    path?: PageId[]
    openPage: PageId[]
    actions: PageActions
    isNameEditing: boolean
    setIsNameEditing: (editing: boolean) => void
}

const pageStyle = {
    paddingX: 0.5,
    indentDepth: 0.5,
    indentClass(depth: number) {
        const paddingLeft = pageStyle.paddingX + depth * pageStyle.indentDepth
        return `pl-[${paddingLeft}rem] pr-[${pageStyle.paddingX}rem]`
    },
}

export function PageEntry<State>({
    page,
    path = [],
    openPage,
    actions,
    isNameEditing,
    setIsNameEditing,
}: PageEntryProps<State>) {
    const depth = path.length
    const pathHere = [ ...path, page.id ]

    const pageInOpenPath = arrayStartsWith(pathHere, openPage.slice(0, -1))
    const pageCollapsed = page.isCollapsed && !pageInOpenPath

    function onChangeName(event: React.ChangeEvent<HTMLInputElement>) {
        actions.setPageName(pathHere, event.target.value)
    }
    function onInputKeyDown(event: React.KeyboardEvent) {
        switch (getFullKey(event)) {
            case "Enter":
            case "Escape":
                onCommitName()
                event.stopPropagation()
                event.preventDefault()
                return
        }
    }
    function onCommitName() {
        if (page.name !== page.name.trim()) {
            actions.setPageName(pathHere, page.name.trim())
        }
        setIsNameEditing(false)
    }
    function onAddChild(event: React.MouseEvent) {
        actions.addPage(pathHere)
        event.stopPropagation()
    }
    function onDeleteChild(event: React.MouseEvent) {
        actions.deletePage(pathHere)
        event.stopPropagation()
    }


    return (
        <>
            <div
                className={`
                    ${pageStyle.indentClass(depth)} py-1 text-left group cursor-pointer flex space-x-2
                    ${arrayEquals(pathHere, openPage) && "bg-gray-300 group-focus/document-ui:bg-blue-300"}
                `}
                onClick={() => actions.openPage(pathHere)}
                >
                {page.children.length > 0 ?
                    <button onClick={() => actions.toggleCollapsed(pathHere)}>
                        <FontAwesomeIcon
                            className="text-gray-500 w-4"
                            icon={pageCollapsed ? solidIcons.faAngleRight : solidIcons.faAngleDown}
                            />
                    </button>
                :
                    <div className="w-4" />
                }

                {isNameEditing && arrayEquals(pathHere, openPage) ? (
                    <input
                        className="flex-1 min-w-0 w-full"
                        type="text"
                        autoFocus
                        value={page.name}
                        placeholder={getDefaultName(page)}
                        onChange={onChangeName}
                        onBlur={onCommitName}
                        onKeyDown={onInputKeyDown}
                        />
                ) : (
                    <>
                        <span className="truncate" onDoubleClick={() => setIsNameEditing(true)}>{getName(page)}</span>
                        <div className="flex-1" />
                        <button
                            className="hidden group-hover:inline-block text-gray-500 hover:text-blue-500"
                            onClick={onDeleteChild}
                            >
                            <FontAwesomeIcon icon={regularIcons.faTrashCan} />
                        </button>
                        <button
                            className="hidden group-hover:inline-block text-gray-500 hover:text-blue-500"
                            onClick={onAddChild}
                            >
                            <FontAwesomeIcon icon={solidIcons.faPlus} />
                        </button>
                    </>
                )}
            </div>
            {!pageCollapsed &&
                <PageChildren
                    page={page}
                    path={pathHere}
                    actions={actions}
                    openPage={openPage}
                    isNameEditing={isNameEditing}
                    setIsNameEditing={setIsNameEditing}
                    />
            }
        </>
    )
}


export function PageChildren<State>({ page, actions, path, openPage, ...props }: PageEntryProps<State>) {
    const keyHere = path.join('.')
    return (
        <>
            {page.children.map(child => (
                <PageEntry
                    key={keyHere + '.' + child.id}
                    page={child}
                    path={path}
                    openPage={openPage}
                    actions={actions}
                    {...props}
                    />
            ))}
        </>
    )
}
