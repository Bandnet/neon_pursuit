import { Game } from './game.js';
import { UI } from './ui.js';
import * as data from './data.js';
window.__data = data;

const game = new Game(document.getElementById('app'));
// Show a loading screen first so the browser paints before the (synchronous) city generation starts.
const ui = new UI(game);
game.ui = ui;
ui.showLoading();
setTimeout(() => {
  game.init();
  ui.showMain();
  window.__game = game; // handy for debugging in the console
}, 60);
