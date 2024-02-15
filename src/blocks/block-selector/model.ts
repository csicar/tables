import * as block from '../../block'
import { Block, BlockUpdater, Environment } from '../../block'
import { computeExpr } from '../../logic/compute'
import { Validator, any, assertValid, oneOf, strict, string } from '../../utils/validate'


export type BlockSelectorState =
    | {
        mode: 'run'
        expr: string
        innerBlock: Block<unknown>
        innerBlockState: unknown
    }
    | {
        mode: 'choose'
        expr: string
        innerBlock?: Block<unknown>
        innerBlockState?: unknown
    }
    | {
        mode: 'loading'
        expr: string
        modeAfter: LoadedMode
        jsonToLoad: any
    }

export type Mode = BlockSelectorState['mode']
export type LoadedMode = Exclude<Mode, 'loading'>


export function init(
    expr: string = '',
    innerBlock?: Block<unknown>
): BlockSelectorState {
    return {
        expr,
        mode: innerBlock ? 'run' : 'choose',
        innerBlock: innerBlock,
        innerBlockState: innerBlock?.init,
    }
}


export function chooseBlock(
    expr: string,
    state: BlockSelectorState,
    blockEnv: Environment,
): BlockSelectorState {
    const blockCmdResult = computeExpr(expr, blockEnv)
    if (block.isBlock(blockCmdResult)) {
        return {
            ...state,
            expr,
            mode: 'run',
            innerBlock: blockCmdResult,
            innerBlockState: blockCmdResult.init,
        }
    }
    return state
}

export function updateBlock(state: BlockSelectorState, action: (state: unknown) => unknown): BlockSelectorState {
    if (state.mode === 'loading') { return state }
    return {
        ...state,
        innerBlockState: action(state.innerBlockState),
    }
}

export function recompute(
    state: BlockSelectorState,
    update: block.BlockUpdater<BlockSelectorState>,
    env: Environment,
    blockLibrary: Environment,
): BlockSelectorState {
    function updateInner(action: (inner: unknown) => unknown) {
        update(state => updateBlock(state, action))
    }

    const innerBlock = computeExpr(state.expr, { ...blockLibrary, ...env })

    if (!block.isBlock(innerBlock)) {
        return state
    }

    if (state.mode === 'loading') {
        return {
            mode: state.modeAfter,
            expr: state.expr,
            innerBlock,
            innerBlockState: innerBlock.fromJSON(state.jsonToLoad, updateInner, env),
        }
    }
        
    return {
        ...state,
        innerBlock,
        innerBlockState: innerBlock.recompute(state.innerBlockState, updateInner, env)
    }
}

export function selectorJSONV(inner: Validator) {
    return strict({
        mode: oneOf('run', 'choose'),
        expr: string,
        inner: inner,
    })
}

export function fromJSON(json: any, update: BlockUpdater<BlockSelectorState>, env: Environment, blockLibrary: Environment): BlockSelectorState {
    assertValid(selectorJSONV(any), json)
    const { mode, inner, expr } = json

    function updateInner(action: (inner: unknown) => unknown) {
        update(state => updateBlock(state, action))
    }

    const innerBlock = computeExpr(expr, { ...blockLibrary, ...env })

    if (!block.isBlock(innerBlock)) {
        return { mode: 'loading', modeAfter: mode, expr, jsonToLoad: inner }
    }

    const innerBlockState = innerBlock.fromJSON(inner, updateInner, env)
    return { mode, expr, innerBlock, innerBlockState }
}
