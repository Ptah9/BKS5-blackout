/**
 * Движок сценария.
 *
 * Сценарий — это данные, а не код: список действий по времени и триггеры
 * по событиям. Сервер единственный, кто их исполняет, и он же рассылает
 * клиентам готовые события — поэтому сценарий нельзя «пройти», поправив
 * сообщение в консоли.
 *
 * Флаги мира живут в базе: свет включён, фонарь найден, дверь открыта.
 * Это нужно, чтобы остановка сервера не откатывала прогресс.
 */

import { readFileSync } from 'node:fs';

export class Scenario {
  /**
   * @param {object} definition содержимое scenario.json
   * @param {{ store: any, broadcast: (event: object) => void, log: (...a: any[]) => void }} hooks
   */
  constructor(definition, hooks) {
    this.definition = definition;
    this.hooks = hooks;
    this.startedAt = null;
    this.firedBeats = new Set();
    this.firedTriggers = new Set();
    /** Текущее состояние мира — чтобы новый игрок догнал сюжет, а не начинал с белого света. */
    this.state = { lights: 1, objective: null };
  }

  static load(file, hooks) {
    const definition = JSON.parse(readFileSync(file, 'utf8'));
    return new Scenario(definition, hooks);
  }

  /** Сценарий стартует, когда в мир заходит первый игрок. */
  start(now = Date.now()) {
    if (this.startedAt !== null) return false;
    this.startedAt = now;
    this.hooks.log('сценарий запущен:', this.definition.id);
    return true;
  }

  get running() {
    return this.startedAt !== null;
  }

  /**
   * Все игроки ушли — сценарий начинается заново для следующего входа,
   * иначе опоздавший попал бы в середину сюжета.
   */
  reset() {
    this.startedAt = null;
    this.firedBeats.clear();
    this.firedTriggers.clear();
    this.state = { lights: 1, objective: null };
  }

  /** Пробегает по действиям и отправляет те, чьё время пришло. */
  tick(now = Date.now()) {
    if (this.startedAt === null) return;
    const elapsed = (now - this.startedAt) / 1000;

    const beats = this.definition.beats ?? [];
    beats.forEach((beat, index) => {
      if (this.firedBeats.has(index)) return;
      if (beat.at > elapsed) return;
      this.firedBeats.add(index);
      this.emit(beat);
    });
  }

  /** Проверка триггеров на событие: вход в зону, установка флага, действие. */
  fire(kind, payload = {}) {
    const triggers = this.definition.triggers ?? [];

    triggers.forEach((trigger, index) => {
      if (this.firedTriggers.has(index)) return;
      if (trigger.on !== kind) return;

      if (trigger.on === 'zone' && trigger.chunk !== payload.chunk) return;
      if (trigger.on === 'flag' && trigger.flag !== payload.flag) return;

      this.firedTriggers.add(index);
      this.emit(trigger);
    });
  }

  emit(action) {
    const { do: verb, ...data } = action;

    if (verb === 'lights') this.state.lights = Number(data.value ?? 1);
    if (verb === 'objective') this.state.objective = String(data.text ?? '');

    this.hooks.broadcast({ kind: verb, data });
  }

  /**
   * События, которые нужно проиграть вошедшему игроку: свет и текущее задание.
   * Без этого поздний игрок оказался бы в освещённом вагоне, пока остальные
   * сидят в темноте.
   */
  stateEvents() {
    const events = [{ kind: 'lights', data: { value: this.state.lights } }];
    if (this.state.objective) {
      events.push({ kind: 'objective', data: { text: this.state.objective } });
    }
    return events;
  }
}
