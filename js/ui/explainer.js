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
      ? 'When the seatbelt sign turns off, people get up, prep their things, and start filling the aisle. The door opens after a short pause. From then on anyone whose row is clear and whose slot in the aisle is free can stand up and walk.'
      : 'People arrive at the gate one at a time, walk toward the back of the plane, and stow their bag at (or near) their row before sitting down.';
    body.innerHTML = `
      <ul>
        <li>${modeLine}</li>
        <li>Every bag pull or stow blocks the aisle slot it happens in. Nothing behind a stopped person moves. That is the whole story.</li>
        <li>People walk about 0.8 metres per second. Getting up takes about 2 to 3 seconds for most people, longer for anyone on a phone. Pulling a bag takes about 9 seconds; stowing one takes longer. The numbers come from research by Schultz (2018) and Wald, Harmon and Klabjan (2014).</li>
        <li>How well people follow the announced order matters more than which order gets announced. When most people ignore the rule, every fancy strategy collapses into free-for-all.</li>
        <li>Opening the back door is by far the biggest win. Each half of the plane drains through its own exit instead of queueing behind the front door.</li>
        <li>Every strategy above rides the same physics. Change a slider and the winner may flip. That is why airlines cannot promise a boarding time.</li>
      </ul>
      <p>Spec: <a href="https://github.com/Maninae/please-remain-seated/blob/main/design/01-spec.md" target="_blank" rel="noopener">design/01-spec.md</a> &middot; Research: <a href="https://github.com/Maninae/please-remain-seated/blob/main/design/02-research.md" target="_blank" rel="noopener">design/02-research.md</a></p>
    `;
  }
}
