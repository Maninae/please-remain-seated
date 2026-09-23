/**
 * "How this works" collapse. Plain-language bullets on the model with links to the spec and
 * research doc. Copy is mode-aware where it matters and stays free of equations per the spec.
 */

export function mountExplainer({ store }) {
  const body = document.getElementById('explainer-body');
  if (!body) return;
  render(store.state());
  store.subscribe(render);

  function render(state) {
    // Fix for NEW-M4: the prior copy said "prep timer runs from door-open", which is the opposite
    // of what the engine does. `t` counts from seatbelt-sign-off, and prep + row exits + bag
    // retrieval all proceed during the staging window before the door opens. State the model
    // truthfully.
    const modeLine = state.mode === 'deplane'
      ? 'Deplaning today: the seatbelt sign goes off, people stand and prep, and rows start filling the aisle. The door opens after a short staging window. From there anyone still READY can stand if their row-mates are out and the aisle cell beside them is free.'
      : 'Boarding today: passengers arrive at the door on an exponential inter-arrival, walk aft, and stow at their bin (or the next one with space).';
    body.innerHTML = `
      <ul>
        <li>${modeLine}</li>
        <li>Every bag retrieval blocks its aisle cell. Nothing behind a stopped person moves. That is the whole story.</li>
        <li>Walking is about 0.8 m/s. Prep is usually 2-3 seconds, with a long tail of distracted passengers who take much longer to notice the aisle. Bag retrieval is usually about 9 seconds; stowing is longer. Numbers taken from Schultz 2018 and Milne and Salari 2016.</li>
        <li>Compliance and families are the killers. Free-for-all is what actually happens; the classroom-optimal orderings assume everybody plays along.</li>
        <li>Opening the rear door cuts deplaning time meaningfully: each half of the plane drains through its own exit instead of queueing behind the front door.</li>
        <li>Every strategy above rides the same physics. Change the sliders and the winner may flip; this is why airlines cannot promise a boarding time.</li>
      </ul>
      <p>Spec: <a href="https://github.com/Maninae/please-remain-seated/blob/main/design/01-spec.md" target="_blank" rel="noopener">design/01-spec.md</a> &middot; Research: <a href="https://github.com/Maninae/please-remain-seated/blob/main/design/02-research.md" target="_blank" rel="noopener">design/02-research.md</a></p>
    `;
  }
}
