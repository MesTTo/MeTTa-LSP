/*
 * SPDX-FileCopyrightText: 2026 MesTTo
 * SPDX-License-Identifier: Apache-2.0
 *
 * Alloy model of the version-gated engine's core invariants (roadmap Phase 1 success criterion):
 *   1. Red-green soundness: after bringing every memo up to date, no query ever serves a stale value,
 *      INCLUDING the backdating early cutoff (a recompute that produces an equal value must not force
 *      dependents to recompute). This is the Salsa maybe_changed_after + backdate logic our IncrementalDb
 *      hand-rolls; the check confirms the strict "changed after my last verify" decision, propagated
 *      transitively over the query DAG, is sound.
 *   2. Epoch independence: the atomspace epoch is not a dependency of any static query, so advancing it
 *      (a space mutation) never disturbs a single static memo.
 *
 * We model one inductive bring-up-to-date STEP: at Prev every memo is verified and holds the true value;
 * at Now some inputs may have changed. Soundness of one step + determinism gives soundness for any edit
 * sequence by induction. Two revisions suffice for the step (Prev = last full verify, Now = current); a
 * memo's changedAt is Prev when its value did not change at Now and Now when it did.
 *
 * Run headless: java -jar org.alloytools.alloy.dist.jar exec -o - <thisfile>.als
 * A "check" finds a counterexample if the assertion can fail; no instance found == invariant holds.
 */

open util/ordering[Rev]

sig Rev {}
sig Val {}

sig Node {
  deps       : set Node,        // dependency edges; inputs have none
  value      : Rev -> one Val,  // the node's TRUE value at each revision
  oldStored  : one Val,         // the memo's value at Prev (pre-state)
  newStored  : one Val,         // the memo's value after bring-up-to-date at Now
  newChanged : one Rev          // changedAt after bring-up: Prev = "unchanged at Now", Now = "changed at Now"
}

fun Prev : Rev { first }
fun Now  : Rev { last }

pred IsInput[n: Node] { no n.deps }
pred IsQuery[n: Node] { some n.deps }

// Our engine's queries form a DAG (the closure walk is flattened into one query, never self-referential).
fact dag { no n: Node | n in n.^deps }

// A query is a deterministic function of its dependencies: if two revisions agree on every dep's value,
// they agree on the query's value. (Inputs are unconstrained — they are the free variables.)
fact determinism {
  all q: Node, r1, r2: Rev |
    IsQuery[q] and (all d: q.deps | d.value[r1] = d.value[r2]) => q.value[r1] = q.value[r2]
}

// Pre-state: at Prev every memo was verified and held the node's true value.
fact soundAtPrev { all n: Node | n.oldStored = n.value[Prev] }

// The bring-up-to-date algorithm, transcribed: an input is always current; a query recomputes iff some
// dependency changed after its last verify (Prev), and on recompute it backdates changedAt when the new
// value equals the stored one, otherwise reuses the memo unchanged (green).
fact bringUpToDate {
  all n: Node {
    IsInput[n] => {
      n.newStored = n.value[Now]
      (n.value[Now] = n.value[Prev]) => n.newChanged = Prev else n.newChanged = Now
    }
    IsQuery[n] => {
      (some d: n.deps | d.newChanged = Now) => {
        n.newStored = n.value[Now]
        (n.value[Now] = n.oldStored) => n.newChanged = Prev else n.newChanged = Now
      } else {
        n.newStored = n.oldStored
        n.newChanged = Prev
      }
    }
  }
}

// (1) Red-green soundness: every memo holds the true current value after bring-up-to-date.
assert Soundness {
  all n: Node | n.newStored = n.value[Now]
}
check Soundness for 7 but exactly 2 Rev

// The atomspace input: an isolated leaf that no static query depends on (our engine never makes the mutable
// atomspace a DB input).
one sig Atomspace in Node {}
fact atomspaceIsIsolatedInput {
  IsInput[Atomspace]
  no n: Node | Atomspace in n.deps
}

// (2) Epoch independence: if the ONLY thing that changed at Now is the atomspace, no static query memo is
// disturbed (evaluating never invalidates a static memo).
assert EpochIndependence {
  (all i: Node | IsInput[i] and i != Atomspace => i.newChanged = Prev)
    => (all q: Node | IsQuery[q] => (q.newStored = q.oldStored and q.newChanged = Prev))
}
check EpochIndependence for 7 but exactly 2 Rev
