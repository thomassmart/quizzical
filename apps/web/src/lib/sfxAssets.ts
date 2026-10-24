/**
 * Bundled UI SFX (synthetic short WAVs). Team buzzers + room/system stings.
 */
import type { BuzzerId, SystemSfxId } from '@quizzical/shared';

import bing from '../assets/sfx/buzzers/bing.wav';
import blip from '../assets/sfx/buzzers/blip.wav';
import boing from '../assets/sfx/buzzers/boing.wav';
import bubble from '../assets/sfx/buzzers/bubble.wav';
import buzz from '../assets/sfx/buzzers/buzz.wav';
import chirp from '../assets/sfx/buzzers/chirp.wav';
import clunk from '../assets/sfx/buzzers/clunk.wav';
import coin from '../assets/sfx/buzzers/coin.wav';
import duck from '../assets/sfx/buzzers/duck.wav';
import fart from '../assets/sfx/buzzers/fart.wav';
import gulp from '../assets/sfx/buzzers/gulp.wav';
import honk from '../assets/sfx/buzzers/honk.wav';
import kazoo from '../assets/sfx/buzzers/kazoo.wav';
import laser from '../assets/sfx/buzzers/laser.wav';
import meep from '../assets/sfx/buzzers/meep.wav';
import ping from '../assets/sfx/buzzers/ping.wav';
import plop from '../assets/sfx/buzzers/plop.wav';
import pop from '../assets/sfx/buzzers/pop.wav';
import powerup from '../assets/sfx/buzzers/powerup.wav';
import quack from '../assets/sfx/buzzers/quack.wav';
import rimshot from '../assets/sfx/buzzers/rimshot.wav';
import rubber from '../assets/sfx/buzzers/rubber.wav';
import snare from '../assets/sfx/buzzers/snare.wav';
import sneeze from '../assets/sfx/buzzers/sneeze.wav';
import sproing from '../assets/sfx/buzzers/sproing.wav';
import thud from '../assets/sfx/buzzers/thud.wav';
import twang from '../assets/sfx/buzzers/twang.wav';
import whistle from '../assets/sfx/buzzers/whistle.wav';
import whoopee from '../assets/sfx/buzzers/whoopee.wav';
import zoink from '../assets/sfx/buzzers/zoink.wav';

import answersOpen from '../assets/sfx/system/answers_open.wav';
import revealAnswer from '../assets/sfx/system/reveal_answer.wav';
import speedWinner from '../assets/sfx/system/speed_winner.wav';
import standings from '../assets/sfx/system/standings.wav';
import timerUp from '../assets/sfx/system/timer_up.wav';
import timerUrgency from '../assets/sfx/system/timer_urgency.wav';
import wager from '../assets/sfx/system/wager.wav';

export const BUZZER_SRC: Record<BuzzerId, string> = {
  zoink,
  fart,
  bing,
  boing,
  honk,
  quack,
  pop,
  blip,
  thud,
  sproing,
  whistle,
  clunk,
  ping,
  buzz,
  chirp,
  plop,
  twang,
  whoopee,
  kazoo,
  laser,
  coin,
  powerup,
  rubber,
  bubble,
  sneeze,
  gulp,
  snare,
  rimshot,
  duck,
  meep,
};

export const SYSTEM_SFX_SRC: Record<SystemSfxId, string> = {
  timer_urgency: timerUrgency,
  timer_up: timerUp,
  answers_open: answersOpen,
  wager,
  reveal_answer: revealAnswer,
  speed_winner: speedWinner,
  standings,
};

export function sfxUrl(id: BuzzerId | SystemSfxId): string | undefined {
  return (
    (BUZZER_SRC as Record<string, string>)[id] ??
    (SYSTEM_SFX_SRC as Record<string, string>)[id]
  );
}
