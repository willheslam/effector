//@flow
//@jsx fx
import fx from 'effector/stdlib/fx'

import invariant from 'invariant'
import * as perf from 'effector/perf'

import {Kind, type kind} from 'effector/stdlib/kind'
import {pushNext, type TypeDef} from 'effector/stdlib/typedef'
import {visitRecord, kindReader} from 'effector/stdlib/visitor'

import $$observable from 'symbol-observable'

import {createStateRef} from 'effector/stdlib/stateref'
import {createEvent, type Event} from 'effector/event'
import {__DEV__} from 'effector/flags'
import type {Store} from './index.h'
import {setStoreName} from './setStoreName'
import {type CompositeName} from '../compositeName'

export function storeFabric<State>(props: {
  currentState: State,
  name?: string,
  parent?: CompositeName,
}): Store<State> {
  const {currentState, name, parent} = props
  const plainState = createStateRef(currentState)
  const currentId = plainState.id
  const defaultState = currentState

  const subscribers = new Map()
  const def = {}
  def.next = <multi />
  def.seq = (
    <seq>
      <single>
        <filter
          filter={(newValue, ctx) =>
            newValue !== undefined && newValue !== plainState.current
          }
        />
      </single>
      <single>
        <update store={plainState} />
      </single>
      {def.next}
    </seq>
  )

  const updater: any = createEvent('update ' + currentId)

  const store = {
    graphite: def,
    defaultState,
    kind: Kind.store,
    id: currentId,
    shortName: currentId,
    domainName: parent,
    setState,
    map,
    on,
    off,
    watch,
    thru,
    subscribe,
    getState,
    reset,
    //$off
    [$$observable]: observable,
  }
  if (name) setStoreName(store, name)
  ;(store: any).dispatch = dispatch
  store.on(updater, (_, payload) => payload)
  function getState() {
    return plainState.current
  }

  const visitors = {
    watch: {
      event({eventOrFn, fn}) {
        invariant(typeof fn === 'function', 'watch requires function handler')
        return eventOrFn.watch(payload =>
          fn(store.getState(), payload, eventOrFn.getType()),
        )
      },
      effect({eventOrFn, fn}) {
        invariant(typeof fn === 'function', 'watch requires function handler')
        return eventOrFn.watch(payload =>
          fn(store.getState(), payload, eventOrFn.getType()),
        )
      },
      __({eventOrFn}) {
        invariant(
          typeof eventOrFn === 'function',
          'watch requires function handler',
        )
        return subscribe(eventOrFn)
      },
    },
  }

  function map(fn, firstState) {
    return mapStore(store, fn, firstState)
  }

  function subscribe(listener) {
    if (__DEV__)
      perf.beginMark(
        'Start ' + getDisplayName(store) + ' subscribe (id: ' + store.id + ')',
      )
    invariant(
      typeof listener === 'function',
      'Expected the listener to be a function.',
    )
    let lastCall = getState()
    let active = true
    const runCmd = (
      <single>
        <run
          runner={args => {
            if (args === lastCall || !active) return
            lastCall = args
            try {
              listener(args)
              if (__DEV__)
                perf.endMark(
                  'Call ' +
                    getDisplayName(store) +
                    ' subscribe listener (id: ' +
                    store.id +
                    ')',
                  'Start ' +
                    getDisplayName(store) +
                    ' subscribe (id: ' +
                    store.id +
                    ')',
                )
            } catch (err) {
              console.error(err)
              if (__DEV__)
                perf.endMark(
                  'Got error on ' +
                    getDisplayName(store) +
                    ' subscribe (id: ' +
                    store.id +
                    ')',
                  'Start ' +
                    getDisplayName(store) +
                    ' subscribe (id: ' +
                    store.id +
                    ')',
                )
            }
          }}
        />
      </single>
    )
    pushNext(runCmd, store.graphite.next)
    listener(lastCall)
    function unsubscribe() {
      active = false
      const i = store.graphite.next.data.indexOf(runCmd)
      if (i === -1) return
      store.graphite.next.data.splice(i, 1)
    }
    unsubscribe.unsubscribe = unsubscribe
    //$off
    return (unsubscribe: {
      (): void,
      unsubscribe(): void,
    })
  }

  function dispatch(action) {
    return action
  }

  function observable() {
    return {
      subscribe(observer) {
        invariant(
          typeof observer === 'object' && observer !== null,
          'Expected the observer to be an object.',
        )

        function observeState(state) {
          if (observer.next) {
            observer.next(state)
          }
        }
        return subscribe(observeState)
      },
      //$off
      [$$observable]() {
        return this
      },
    }
  }

  function reset(event) {
    return store.on(event, () => defaultState)
  }
  function off(event: Event<any>) {
    const currentSubscription = subscribers.get(event)
    if (currentSubscription === undefined) return
    currentSubscription()
    subscribers.delete(event)
  }
  function on(event: any, handler: Function) {
    const e: Event<any> = event
    const nextSeq = (
      <seq>
        <single>
          <compute
            fn={(_, newValue, ctx) => {
              const lastState = getState()
              return handler(lastState, newValue, e.getType())
            }}
          />
        </single>
        <single>
          <filter
            filter={(data, ctx: TypeDef<'compute', 'ctx'>) => {
              const lastState = getState()
              return data !== lastState && data !== undefined
            }}
          />
        </single>
        {store.graphite.seq}
      </seq>
    )
    pushNext(nextSeq, e.graphite.next)
    subscribers.set(e, () => {
      const i = e.graphite.next.data.indexOf(nextSeq)
      if (i === -1) return
      e.graphite.next.data.splice(i, 1)
    })
    return store
  }

  function watch(eventOrFn: Event<*> | Function, fn?: Function) {
    return visitRecord(visitors.watch, {
      __kind: kindReader(eventOrFn),
      args: {eventOrFn, fn},
    })
  }

  function stateSetter(_, payload) {
    return payload
  }
  function setState(value, reduce?: Function) {
    const currentReducer = typeof reduce === 'function' ? reduce : stateSetter
    const state = getState()
    const newResult = currentReducer(state, value)

    updater(newResult)
  }

  function thru(fn: Function) {
    return fn(store)
  }

  return store
}

export function getDisplayName<A>(store: Store<A>) {
  if (store.compositeName) {
    return store.compositeName.fullName
  }
  if (store.domainName) {
    return store.domainName.fullName
  }
  return store.id
}

function mapStore<A, B>(
  store: Store<A>,
  fn: (state: A, lastState?: B) => B,
  firstState?: B,
): Store<B> {
  if (__DEV__)
    perf.beginMark(`Start ${getDisplayName(store)} map (id: ${store.id})`)
  let lastValue = store.getState()
  let lastResult = fn(lastValue, firstState)
  const innerStore: Store<any> = storeFabric({
    name: '' + store.shortName + ' → *',
    currentState: lastResult,
    parent: store.domainName,
  })
  const nextSeq = (
    <seq>
      <single>
        <compute
          fn={(_, newValue, ctx) => {
            lastValue = newValue
            const lastState = innerStore.getState()
            const result = fn(newValue, lastState)
            if (__DEV__)
              perf.endMark(
                'Map ' + getDisplayName(store) + ' (id: ${store.id})',
                'Start ' +
                  getDisplayName(store) +
                  ' subscribe (id: ' +
                  store.id +
                  ')',
              )
            return result
          }}
        />
      </single>
      <single>
        <filter
          filter={(result, ctx: TypeDef<'compute', 'ctx'>) => {
            const lastState = innerStore.getState()
            const isChanged = result !== lastState && result !== undefined
            if (isChanged) {
              lastResult = result
            }
            return isChanged
          }}
        />
      </single>
      {innerStore.graphite.seq}
    </seq>
  )
  pushNext(nextSeq, store.graphite.next)
  const off = () => {
    const i = store.graphite.next.data.indexOf(nextSeq)
    if (i === -1) return
    store.graphite.next.data.splice(i, 1)
  }
  return innerStore
}
