/* ============================================================
   ShiftCheck – Main Application
   Pure vanilla JavaScript. No dependencies.
   ============================================================ */

'use strict';

/* ============================================================
   SECTION 1: SCHEDULE CALCULATION LOGIC
   This is the core engine. It calculates any date from
   a reference date and a repeating rotation pattern.
   ============================================================ */

const ScheduleEngine = {

  MS_PER_DAY: 86400000,

  /** Parse "YYYY-MM-DD" into a UTC Date (avoids timezone day-shift bugs). */
  parseDate(dateStr) {
    const parts = dateStr.split('-');
    return new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  },

  /** Format a UTC Date as "YYYY-MM-DD". */
  formatDate(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  },

  /** Add (or subtract) days from a date string. */
  addDays(dateStr, days) {
    const d = this.parseDate(dateStr);
    d.setUTCDate(d.getUTCDate() + days);
    return this.formatDate(d);
  },

  /** Whole-day difference: target minus reference. */
  daysBetween(referenceDate, targetDate) {
    const ref = this.parseDate(referenceDate);
    const tgt = this.parseDate(targetDate);
    return Math.round((tgt - ref) / this.MS_PER_DAY);
  },

  /** Positive modulo – handles negative offsets for past dates. */
  mod(n, m) {
    return ((n % m) + m) % m;
  },

  /**
   * Expand rotation steps into a flat array.
   * Each entry is a shift ID string, or null for OFF.
   * Example: [morning, morning, afternoon, afternoon, night, night, null, null]
   */
  expandRotation(rotation) {
    const expanded = [];
    for (let i = 0; i < rotation.length; i++) {
      const step = rotation[i];
      const value = step.type === 'off' ? null : step.shiftId;
      for (let d = 0; d < step.duration; d++) {
        expanded.push(value);
      }
    }
    return expanded;
  },

  /** Total number of days in one full rotation cycle. */
  getCycleLength(rotation) {
    let total = 0;
    for (let i = 0; i < rotation.length; i++) {
      total += rotation[i].duration;
    }
    return total;
  },

  /**
   * CORE FUNCTION: calculateSchedule
   *
   * @param {string} referenceDate  - Anchor date "YYYY-MM-DD"
   * @param {string|null} referenceShiftId - Shift on anchor (null = OFF)
   * @param {string} targetDate - Date to look up
   * @param {Array} rotation - Rotation steps
   * @param {Array} shifts - Shift definitions
   * @param {number} referenceCycleIndex - Exact position in cycle (optional)
   * @returns {Object} { isOff, shiftId, shift, cycleIndex }
   */
  calculateSchedule(referenceDate, referenceShiftId, targetDate, rotation, shifts, referenceCycleIndex) {
    const expanded = this.expandRotation(rotation);
    const cycleLength = expanded.length;

    if (cycleLength === 0) {
      return { isOff: true, shiftId: null, shift: null, cycleIndex: 0, blockDay: 1, blockLength: 1 };
    }

    // Determine where the reference date sits in the cycle
    let refIndex;
    if (typeof referenceCycleIndex === 'number') {
      refIndex = this.mod(referenceCycleIndex, cycleLength);
    } else {
      refIndex = expanded.indexOf(referenceShiftId);
      if (refIndex === -1) refIndex = 0;
    }

    // How many days from reference to target?
    const dayDiff = this.daysBetween(referenceDate, targetDate);

    // Position in cycle for the target date
    const targetIndex = this.mod(refIndex + dayDiff, cycleLength);
    const shiftId = expanded[targetIndex];

    // Look up full shift details
    let shift = null;
    if (shiftId) {
      for (let i = 0; i < shifts.length; i++) {
        if (shifts[i].id === shiftId) {
          shift = shifts[i];
          break;
        }
      }
    }

    const block = this.getBlockPosition(rotation, targetIndex);

    return {
      isOff: shiftId === null,
      shiftId: shiftId,
      shift: shift,
      cycleIndex: targetIndex,
      blockDay: block.dayInBlock,
      blockLength: block.blockLength
    };
  },

  /**
   * Which day of a consecutive block this cycle index is on.
   * Example: Morning for 2 days → day 1 = first Morning, day 2 = second Morning.
   */
  getBlockPosition(rotation, cycleIndex) {
    let offset = 0;
    for (let i = 0; i < rotation.length; i++) {
      const step = rotation[i];
      const duration = step.duration || 0;
      if (duration <= 0) continue;
      if (cycleIndex >= offset && cycleIndex < offset + duration) {
        return {
          dayInBlock: cycleIndex - offset + 1,
          blockLength: duration
        };
      }
      offset += duration;
    }
    return { dayInBlock: 1, blockLength: 1 };
  },

  /** "first", "second", "3rd", etc. */
  formatOrdinalWord(n) {
    const words = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
    if (n >= 1 && n < words.length) return words[n];
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    const last = n % 10;
    if (last === 1) return n + 'st';
    if (last === 2) return n + 'nd';
    if (last === 3) return n + 'rd';
    return n + 'th';
  },

  /**
   * Human label such as "First Morning" or "Second OFF".
   * Always shown when the block lasts more than one day.
   */
  formatBlockDayLabel(result) {
    if (!result || !result.blockLength || result.blockLength < 2) return '';
    const ordinal = this.formatOrdinalWord(result.blockDay);
    const name = result.isOff ? 'OFF' : (result.shift ? result.shift.name : 'shift');
    return ordinal.charAt(0).toUpperCase() + ordinal.slice(1) + ' ' + name;
  },

  /** Find all cycle positions that match a given shift (or OFF). */
  findMatchingPositions(rotation, shiftId) {
    const expanded = this.expandRotation(rotation);
    const positions = [];
    for (let i = 0; i < expanded.length; i++) {
      if (expanded[i] === shiftId) positions.push(i);
    }
    return positions;
  },

  /** Format date for display: "Wednesday, August 12, 2026" */
  formatDisplayDate(dateStr) {
    const d = this.parseDate(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'UTC'
    });
  },

  /** Short date: "Aug 12, 2026" */
  formatShortDate(dateStr) {
    const d = this.parseDate(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    });
  },

  /** Get today's date as YYYY-MM-DD using local timezone. */
  getToday() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  },

  /** Convert 24h "HH:MM" to 12h display like "6:00 AM". */
  formatTime(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parts[1];
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return h12 + ':' + m + ' ' + period;
  },

  /** Format shift time range. Overnight shifts shown as entered. */
  formatShiftTime(shift) {
    if (!shift) return '';
    const start = shift.startTime ? this.formatTime(shift.startTime) : '';
    const end = shift.endTime ? this.formatTime(shift.endTime) : '';
    if (start && end) return start + ' - ' + end;
    return start || end;
  },

  /** Find next working day or next off day after a given date. */
  findNext(schedule, fromDate, wantOff, maxDays) {
    maxDays = maxDays || 366;
    for (let i = 1; i <= maxDays; i++) {
      const date = this.addDays(fromDate, i);
      const result = this.calculateSchedule(
        schedule.referenceDate, schedule.referenceShiftId,
        date, schedule.rotation, schedule.shifts, schedule.referenceCycleIndex
      );
      if (wantOff && result.isOff) return { date: date, result: result };
      if (!wantOff && !result.isOff) return { date: date, result: result };
    }
    return null;
  }
};


/* ============================================================
   SECTION 2: LOCALSTORAGE LOGIC
   Saves and loads the user's schedule configuration.
   ============================================================ */

const StorageManager = {

  STORAGE_KEY: 'shiftcheck_schedule',

  /** Default shift definitions for new users. */
  getDefaultShifts() {
    return [
      { id: 'shift_1', name: 'Morning', startTime: '06:00', endTime: '14:00', emoji: '☀️' },
      { id: 'shift_2', name: 'Afternoon', startTime: '14:00', endTime: '22:00', emoji: '🌆' },
      { id: 'shift_3', name: 'Night', startTime: '22:00', endTime: '06:00', emoji: '🌙' }
    ];
  },

  /** Default rotation: 2 Morning, 2 Afternoon, 2 Night, 2 OFF. */
  getDefaultRotation(shiftIds) {
    return [
      { type: 'shift', shiftId: shiftIds[0], duration: 2 },
      { type: 'shift', shiftId: shiftIds[1], duration: 2 },
      { type: 'shift', shiftId: shiftIds[2], duration: 2 },
      { type: 'off', duration: 2 }
    ];
  },

  /** Create a fresh default schedule object. */
  createDefault() {
    const shifts = this.getDefaultShifts();
    return {
      shifts: shifts,
      rotation: this.getDefaultRotation(shifts.map(function(s) { return s.id; })),
      referenceDate: ScheduleEngine.getToday(),
      referenceShiftId: shifts[0].id,
      referenceCycleIndex: 0,
      programs: []
    };
  },

  /** Ensure older saved schedules have a programs list. */
  normalizeSchedule(schedule) {
    if (!schedule.programs || !Array.isArray(schedule.programs)) {
      schedule.programs = [];
    }
    return schedule;
  },

  /** Load schedule from localStorage. Returns null if none saved. */
  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;
      return this.normalizeSchedule(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  },

  /** Save schedule to localStorage. */
  save(schedule) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(schedule));
  },

  /** Remove saved schedule. */
  reset() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  /** Check if a saved schedule exists and is valid. */
  isConfigured(schedule) {
    if (!schedule) return false;
    if (!schedule.rotation || schedule.rotation.length === 0) return false;
    if (!schedule.referenceDate) return false;
    if (schedule.referenceShiftId === undefined || schedule.referenceShiftId === '') return false;
    return ScheduleEngine.getCycleLength(schedule.rotation) > 0;
  }
};


/* ============================================================
   SECTION 3: CALENDAR LOGIC
   Generates a monthly calendar grid dynamically.
   ============================================================ */

const CalendarManager = {

  /** Get array of date strings for a month. null = empty cell. */
  getMonthDays(year, month) {
    const firstDay = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const daysInMonth = lastDay.getUTCDate();
    const startDow = firstDay.getUTCDay(); // 0=Sun

    const days = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const m = String(month + 1).padStart(2, '0');
      const day = String(d).padStart(2, '0');
      days.push(year + '-' + m + '-' + day);
    }
    return days;
  },

  /** Get month label like "August 2026". */
  getMonthLabel(year, month) {
    const d = new Date(Date.UTC(year, month, 1));
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  },

  /** Determine CSS class for a calendar day based on shift. */
  getDayClass(result) {
    if (result.isOff) return 'cal-off';
    if (!result.shift) return 'cal-custom';
    const name = result.shift.name.toLowerCase();
    if (name.indexOf('morning') !== -1 || name.indexOf('day') !== -1) return 'cal-morning';
    if (name.indexOf('afternoon') !== -1 || name.indexOf('evening') !== -1) return 'cal-afternoon';
    if (name.indexOf('night') !== -1) return 'cal-night';
    return 'cal-custom';
  },

  /** Short label for calendar cell. */
  /** Short label so calendar cells fit on narrow screens. */
  getDayLabel(result) {
    if (result.isOff) return 'OFF';
    if (!result.shift) return '?';
    const name = result.shift.name.trim();
    const lower = name.toLowerCase();
    if (lower.indexOf('morning') !== -1 || lower.indexOf('day shift') !== -1) return 'M';
    if (lower.indexOf('afternoon') !== -1 || lower.indexOf('evening') !== -1) return 'A';
    if (lower.indexOf('night') !== -1) return 'N';
    if (name.length <= 4) return name;
    return name.substring(0, 3);
  },

  getDayTitle(result) {
    if (result.isOff) return 'Off day';
    if (!result.shift) return 'Unknown';
    return result.shift.name + ' shift';
  }
};


/* ============================================================
   SECTION 4: VALIDATION
   ============================================================ */

const Validator = {

  validateSchedule(schedule) {
    if (!schedule.shifts || schedule.shifts.length === 0) {
      return 'Please add at least one shift.';
    }
    for (let i = 0; i < schedule.shifts.length; i++) {
      if (!schedule.shifts[i].name || !schedule.shifts[i].name.trim()) {
        return 'Every shift must have a name.';
      }
    }
    if (!schedule.rotation || schedule.rotation.length === 0) {
      return 'Please add at least one rotation step.';
    }
    for (let j = 0; j < schedule.rotation.length; j++) {
      const step = schedule.rotation[j];
      if (!step.duration || step.duration <= 0) {
        return 'Step ' + (j + 1) + ': duration must be greater than 0.';
      }
      if (step.type === 'shift' && !step.shiftId) {
        return 'Step ' + (j + 1) + ': please select a shift.';
      }
    }
    if (ScheduleEngine.getCycleLength(schedule.rotation) === 0) {
      return 'Rotation cannot have zero total days.';
    }
    if (!schedule.referenceDate) {
      return 'Please select a reference date.';
    }
    if (schedule.referenceShiftId === undefined || schedule.referenceShiftId === '') {
      return 'Please select your shift on the reference date.';
    }
    return null;
  }
};


/* ============================================================
   SECTION 5: UI LOGIC
   Renders screens, handles user interactions.
   ============================================================ */

const App = {

  schedule: null,
  calendarYear: 0,
  calendarMonth: 0,
  isEditing: false,

  /** Generate a unique ID. */
  uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  },

  /** Start the application. */
  init() {
    const now = new Date();
    this.calendarYear = now.getFullYear();
    this.calendarMonth = now.getMonth();

    this.schedule = StorageManager.load();

    if (StorageManager.isConfigured(this.schedule)) {
      this.showDashboard();
    } else {
      this.schedule = StorageManager.createDefault();
      this.showSetup();
    }

    this.bindEvents();
  },

  /** Jump to the top of the page so a new screen starts at the header. */
  scrollToTop() {
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    requestAnimationFrame(function() {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    setTimeout(function() {
      window.scrollTo(0, 0);
    }, 50);
  },

  /** Switch to setup screen. */
  showSetup() {
    document.getElementById('setup-screen').hidden = false;
    document.getElementById('dashboard-screen').hidden = true;
    document.getElementById('cancel-setup-btn').hidden = !this.isEditing;
    this.renderSetup();
    this.scrollToTop();
  },

  /** Switch to dashboard. */
  showDashboard() {
    document.getElementById('setup-screen').hidden = true;
    document.getElementById('dashboard-screen').hidden = false;
    this.isEditing = false;
    this.renderDashboard();
    this.scrollToTop();
  },

  /** Show an error message on the setup screen. */
  showError(msg) {
    const el = document.getElementById('setup-error');
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  },

  showSetupInfo(msg) {
    const el = document.getElementById('setup-info');
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  },

  /** Re-render rotation, preview, and reference — keep shift inputs as-is. */
  refreshSetupDependents() {
    this.renderRotationList();
    this.renderRotationPreview();
    this.renderRefShiftOptions();
    document.getElementById('cycle-length').textContent =
      ScheduleEngine.getCycleLength(this.schedule.rotation);
  },

  /**
   * Keep rotation & reference in sync when shifts change.
   * Removes rotation steps tied to deleted shifts; fixes broken references.
   */
  reconcileRotationWithShifts() {
    const validIds = this.schedule.shifts.map(function(s) { return s.id; });
    const firstId = validIds.length ? validIds[0] : null;
    let removedSteps = 0;

    const kept = [];
    for (let i = 0; i < this.schedule.rotation.length; i++) {
      const step = this.schedule.rotation[i];
      if (step.type === 'off') {
        kept.push(step);
        continue;
      }
      if (step.shiftId && validIds.indexOf(step.shiftId) !== -1) {
        kept.push(step);
      } else {
        removedSteps++;
      }
    }
    this.schedule.rotation = kept;

    for (let j = 0; j < this.schedule.rotation.length; j++) {
      const st = this.schedule.rotation[j];
      if (st.type === 'shift' && st.shiftId && validIds.indexOf(st.shiftId) === -1) {
        st.shiftId = firstId;
      }
    }

    if (this.schedule.referenceShiftId && validIds.indexOf(this.schedule.referenceShiftId) === -1) {
      this.schedule.referenceShiftId = firstId;
    }

    return removedSteps;
  },

  /** Sync rotation/reference after shift list changed (data already updated). */
  syncAfterShiftChange(showMessage) {
    const removed = this.reconcileRotationWithShifts();
    this.refreshSetupDependents();
    this.showError('');
    if (showMessage !== false) {
      let msg = 'Rotation builder and reference options are updated.';
      if (removed > 0) {
        msg = 'Removed ' + removed + ' rotation step(s) that used deleted shifts. ' + msg;
      }
      this.showSetupInfo(msg);
      const self = this;
      setTimeout(function() { self.showSetupInfo(''); }, 4000);
    }
    return removed;
  },

  /** Collect shifts from form, sync rotation/reference, refresh UI. */
  applyShiftChanges(showMessage) {
    this.collectShiftsFromDOM();
    this.collectRotationFromDOM();
    this.syncAfterShiftChange(showMessage);
  },

  /* ---- Setup screen rendering ---- */

  renderSetup() {
    this.renderShiftsList();
    this.renderRotationList();
    this.renderRotationPreview();
    this.renderRefShiftOptions();
    document.getElementById('ref-date').value = this.schedule.referenceDate || '';
    document.getElementById('cycle-length').textContent = ScheduleEngine.getCycleLength(this.schedule.rotation);
    this.showError('');
    this.showSetupInfo('');
  },

  renderShiftsList() {
    const container = document.getElementById('shifts-list');
    let html = '';
    for (let i = 0; i < this.schedule.shifts.length; i++) {
      const s = this.schedule.shifts[i];
      html += '<div class="shift-row" data-shift-id="' + s.id + '">';
      html += '<input type="text" class="input input-emoji" value="' + (s.emoji || '⏰') + '" data-field="emoji" maxlength="2" title="Icon" />';
      html += '<div class="shift-row-fields">';
      html += '<input type="text" class="input" value="' + this.esc(s.name) + '" data-field="name" placeholder="Shift name" />';
      html += '<div class="shift-row-times">';
      html += '<input type="time" class="input" value="' + (s.startTime || '') + '" data-field="startTime" />';
      html += '<span>to</span>';
      html += '<input type="time" class="input" value="' + (s.endTime || '') + '" data-field="endTime" />';
      html += '</div></div>';
      html += '<button type="button" class="btn-remove" data-action="remove-shift" title="Remove">&times;</button>';
      html += '</div>';
    }
    container.innerHTML = html;
  },

  renderRotationList() {
    const container = document.getElementById('rotation-list');
    let html = '';
    for (let i = 0; i < this.schedule.rotation.length; i++) {
      html += this.renderRotationStep(this.schedule.rotation[i], i);
    }
    container.innerHTML = html;
  },

  renderRotationStep(step, index) {
    const validIds = this.schedule.shifts.map(function(s) { return s.id; });
    if (step.type === 'shift' && step.shiftId && validIds.indexOf(step.shiftId) === -1) {
      step.shiftId = this.schedule.shifts[0] ? this.schedule.shifts[0].id : null;
    }

    let shiftOptions = '<option value="off"' + (step.type === 'off' ? ' selected' : '') + '>OFF</option>';
    for (let i = 0; i < this.schedule.shifts.length; i++) {
      const s = this.schedule.shifts[i];
      const sel = (step.type === 'shift' && step.shiftId === s.id) ? ' selected' : '';
      shiftOptions += '<option value="' + s.id + '"' + sel + '>' + this.esc(s.name) + '</option>';
    }

    return '<div class="rotation-step" data-index="' + index + '">' +
      '<span class="rotation-step-num">Step ' + (index + 1) + '</span>' +
      '<select class="input rotation-step-select" data-field="stepType">' + shiftOptions + '</select>' +
      '<input type="number" class="input input-number" value="' + step.duration + '" min="1" max="30" data-field="duration" />' +
      '<span class="rotation-step-days">days</span>' +
      '<button type="button" class="btn-remove" data-action="remove-step" title="Remove">&times;</button>' +
      '</div>';
  },

  renderRotationPreview() {
    const expanded = ScheduleEngine.expandRotation(this.schedule.rotation);
    const container = document.getElementById('rotation-preview');
    if (expanded.length === 0) {
      container.innerHTML = '<span class="hint">Add steps to see preview</span>';
      return;
    }
    let html = '';
    for (let i = 0; i < expanded.length; i++) {
      if (expanded[i] === null) {
        html += '<span class="preview-chip preview-chip-off">🏠 OFF</span>';
      } else {
        const shift = this.findShift(expanded[i]);
        if (shift) {
          html += '<span class="preview-chip" style="background:#f0f0f0;border-color:#ccc">' +
            (shift.emoji || '') + ' ' + this.esc(shift.name.charAt(0)) + '</span>';
        }
      }
    }
    container.innerHTML = html;
  },

  renderRefShiftOptions() {
    const select = document.getElementById('ref-shift');
    let html = '<option value="">-- Select shift --</option>';
    for (let i = 0; i < this.schedule.shifts.length; i++) {
      const s = this.schedule.shifts[i];
      const sel = this.schedule.referenceShiftId === s.id ? ' selected' : '';
      html += '<option value="' + s.id + '"' + sel + '>' + (s.emoji || '') + ' ' + this.esc(s.name) + '</option>';
    }
    // OFF option
    const offSel = this.schedule.referenceShiftId === null ? ' selected' : '';
    html += '<option value="off"' + offSel + '>🏠 OFF</option>';
    select.innerHTML = html;
    this.updateRefPositionPicker();
  },

  updateRefPositionPicker() {
    const refShiftVal = document.getElementById('ref-shift').value;
    const shiftId = refShiftVal === 'off' ? null : refShiftVal;
    const positions = ScheduleEngine.findMatchingPositions(this.schedule.rotation, shiftId);
    const wrap = document.getElementById('ref-position-wrap');
    const select = document.getElementById('ref-position');

    if (positions.length > 1) {
      wrap.hidden = false;
      let html = '';
      const expanded = ScheduleEngine.expandRotation(this.schedule.rotation);
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        let label = 'Position ' + (pos + 1);
        if (expanded[pos]) {
          const shift = this.findShift(expanded[pos]);
          if (shift) label = shift.emoji + ' ' + shift.name + ' – ' + label;
        } else {
          label = '🏠 OFF – ' + label;
        }
        const sel = (this.schedule.referenceCycleIndex === pos) ? ' selected' : '';
        html += '<option value="' + pos + '"' + sel + '>' + label + '</option>';
      }
      select.innerHTML = html;
    } else {
      wrap.hidden = true;
      this.schedule.referenceCycleIndex = positions.length > 0 ? positions[0] : 0;
    }
  },

  /* ---- Dashboard rendering ---- */

  renderDashboard() {
    const today = ScheduleEngine.getToday();
    this.ensureProgramsArray();
    this.renderToday(today);
    this.renderLookup('');
    document.getElementById('lookup-date').value = today;
    this.renderCalendar();
    this.renderUpcoming(today);
    this.renderProgramPlanner();
  },

  ensureProgramsArray() {
    if (!this.schedule.programs || !Array.isArray(this.schedule.programs)) {
      this.schedule.programs = [];
    }
  },

  setupProgramDateInput() {
    const input = document.getElementById('program-date');
    if (!input) return;
    input.removeAttribute('min');
    input.removeAttribute('max');
    if (!input.value) {
      input.value = ScheduleEngine.getToday();
    }
  },

  validateProgramDate(dateStr) {
    if (!dateStr) return 'Please choose a program date.';
    return null;
  },

  showProgramError(msg) {
    const el = document.getElementById('program-error');
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  },

  getProgramFormValues() {
    return {
      name: (document.getElementById('program-name').value || '').trim(),
      date: document.getElementById('program-date').value
    };
  },

  checkProgramShift() {
    const values = this.getProgramFormValues();
    const err = this.validateProgramDate(values.date);
    if (err) {
      this.showProgramError(err);
      return;
    }
    this.showProgramError('');
    const result = this.getResult(values.date);
    const container = document.getElementById('program-result');
    let html = this.buildResultHTML(values.date, result, false);
    if (values.name) {
      html = '<p class="program-item-name" style="margin-bottom:0.5rem">📌 ' + this.esc(values.name) + '</p>' + html;
    }
    container.innerHTML = html;
  },

  saveProgram() {
    const values = this.getProgramFormValues();
    const err = this.validateProgramDate(values.date);
    if (err) {
      this.showProgramError(err);
      return;
    }
    this.showProgramError('');
    this.ensureProgramsArray();

    const duplicate = this.schedule.programs.some(function(p) {
      return p.date === values.date && (p.name || '') === (values.name || '');
    });
    if (duplicate) {
      this.showProgramError('This program is already in your list.');
      return;
    }

    this.schedule.programs.push({
      id: this.uid(),
      name: values.name,
      date: values.date
    });

    this.schedule.programs.sort(function(a, b) {
      return a.date.localeCompare(b.date);
    });

    StorageManager.save(this.schedule);
    this.renderProgramList();
    this.checkProgramShift();
  },

  removeProgram(programId) {
    this.ensureProgramsArray();
    this.schedule.programs = this.schedule.programs.filter(function(p) {
      return p.id !== programId;
    });
    StorageManager.save(this.schedule);
    this.renderProgramList();
  },

  buildProgramStatusLine(result) {
    const block = ScheduleEngine.formatBlockDayLabel(result);
    if (result.isOff) {
      const offText = block
        ? '🏠 ' + block.toUpperCase() + ' — You are off that day'
        : '🏠 OFF — You are off that day';
      return { text: offText, off: true };
    }
    const shift = result.shift;
    const time = ScheduleEngine.formatShiftTime(shift);
    let text = (shift.emoji || '') + ' ';
    text += block ? block.toUpperCase() + ' SHIFT' : shift.name.toUpperCase() + ' SHIFT';
    if (time) text += ' · ' + time;
    return { text: text, off: false };
  },

  renderProgramList() {
    const list = document.getElementById('program-list');
    const empty = document.getElementById('program-list-empty');
    if (!list) return;

    this.ensureProgramsArray();
    const upcoming = this.schedule.programs.slice();

    if (upcoming.length === 0) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;

    let html = '';
    for (let i = 0; i < upcoming.length; i++) {
      const prog = upcoming[i];
      const result = this.getResult(prog.date);
      const status = this.buildProgramStatusLine(result);
      const title = prog.name ? this.esc(prog.name) : 'Program';

      html += '<li class="program-item" data-program-id="' + prog.id + '" data-program-name="' + this.esc(prog.name || '') + '">';
      html += '<div class="program-item-main">';
      html += '<p class="program-item-name">' + title + '</p>';
      html += '<p class="program-item-date">' + ScheduleEngine.formatDisplayDate(prog.date) + '</p>';
      html += '<p class="program-item-status' + (status.off ? ' program-item-status--off' : '') + '">' +
        this.esc(status.text) + '</p>';
      html += '</div>';
      html += '<div class="program-item-actions">';
      html += '<button type="button" class="btn btn-secondary btn-small" data-action="program-view" data-date="' +
        prog.date + '">Details</button>';
      html += '<button type="button" class="btn btn-secondary btn-small" data-action="program-remove" data-id="' +
        prog.id + '">Remove</button>';
      html += '</div></li>';
    }

    list.innerHTML = html;
  },

  renderProgramPlanner() {
    this.setupProgramDateInput();
    this.renderProgramList();
    const resultBox = document.getElementById('program-result');
    if (resultBox && !resultBox.innerHTML.trim()) {
      resultBox.innerHTML = '';
    }
    this.showProgramError('');
  },

  viewProgramDetails(dateStr, name) {
    document.getElementById('program-date').value = dateStr;
    if (name) document.getElementById('program-name').value = name;
    this.checkProgramShift();
    document.getElementById('program-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  renderToday(dateStr) {
    const result = this.getResult(dateStr);
    document.getElementById('today-result').innerHTML = this.buildResultHTML(dateStr, result, true);
  },

  renderLookup(dateStr) {
    const container = document.getElementById('lookup-result');
    if (!dateStr) {
      container.innerHTML = '<p class="hint">Select a date and click "Check Schedule".</p>';
      return;
    }
    const result = this.getResult(dateStr);
    container.innerHTML = this.buildResultHTML(dateStr, result, false);
  },

  renderCalendar() {
    document.getElementById('calendar-month-label').textContent =
      CalendarManager.getMonthLabel(this.calendarYear, this.calendarMonth);

    const days = CalendarManager.getMonthDays(this.calendarYear, this.calendarMonth);
    const today = ScheduleEngine.getToday();
    const grid = document.getElementById('calendar-grid');
    let html = '';

    for (let i = 0; i < days.length; i++) {
      if (days[i] === null) {
        html += '<span class="cal-day cal-empty"></span>';
        continue;
      }
      const dateStr = days[i];
      const result = this.getResult(dateStr);
      const dayNum = parseInt(dateStr.split('-')[2], 10);
      const cssClass = CalendarManager.getDayClass(result);
      const label = CalendarManager.getDayLabel(result);
      const title = CalendarManager.getDayTitle(result);
      const todayClass = dateStr === today ? ' cal-today' : '';

      html += '<button type="button" class="cal-day ' + cssClass + todayClass + '" data-date="' + dateStr + '" title="' + this.esc(title) + '">';
      html += '<span class="cal-num">' + dayNum + '</span>';
      html += '<span class="cal-label">' + this.esc(label) + '</span>';
      html += '</button>';
    }

    grid.innerHTML = html;

    // Bind click on calendar days
    const dayButtons = grid.querySelectorAll('.cal-day[data-date]');
    for (let j = 0; j < dayButtons.length; j++) {
      dayButtons[j].addEventListener('click', function() {
        App.openDayModal(this.getAttribute('data-date'));
      });
    }
  },

  renderUpcoming(fromDate) {
    const nextWork = ScheduleEngine.findNext(this.schedule, fromDate, false);
    const nextOff = ScheduleEngine.findNext(this.schedule, fromDate, true);

    const workEl = document.getElementById('next-work-result');
    const offEl = document.getElementById('next-off-result');

    if (nextWork) {
      const r = nextWork.result;
      workEl.innerHTML =
        '<p class="upcoming-date">' + ScheduleEngine.formatShortDate(nextWork.date) + '</p>' +
        '<p class="upcoming-shift">' + (r.shift ? r.shift.emoji + ' ' + this.esc(r.shift.name) + ' Shift' : '') + '</p>' +
        '<p class="upcoming-time">' + ScheduleEngine.formatShiftTime(r.shift) + '</p>';
    } else {
      workEl.innerHTML = '<p class="hint">—</p>';
    }

    if (nextOff) {
      offEl.innerHTML =
        '<p class="upcoming-date">' + ScheduleEngine.formatShortDate(nextOff.date) + '</p>' +
        '<p class="upcoming-shift">🏠 OFF DAY</p>';
    } else {
      offEl.innerHTML = '<p class="hint">—</p>';
    }
  },

  /** Build HTML for a schedule result display. */
  buildResultHTML(dateStr, result, isToday) {
    let html = '<div class="result-block">';
    html += '<p class="result-date">' + ScheduleEngine.formatDisplayDate(dateStr) + '</p>';
    const blockLabel = ScheduleEngine.formatBlockDayLabel(result);
    const blockDetail = (result.blockLength > 1)
      ? 'Day ' + result.blockDay + ' of ' + result.blockLength + ' in this block'
      : '';

    if (result.isOff) {
      html += '<div class="result-off">';
      html += '<p class="result-status status-off">OFF DAY</p>';
      if (blockLabel) {
        html += '<p class="result-shift result-block-day">' + this.esc(blockLabel.toUpperCase()) + '</p>';
      }
      html += '<p class="result-off-msg">You are not scheduled to work' + (isToday ? ' today' : '') + '.</p>';
      if (blockDetail) html += '<p class="result-block-meta">' + blockDetail + '</p>';
      html += '</div>';
    } else {
      const shift = result.shift;
      const borderColor = this.getShiftColor(shift);
      html += '<div class="result-work" style="border-color:' + borderColor + ';background:' + borderColor + '10">';
      html += '<p class="result-status status-working">WORKING</p>';
      if (blockLabel) {
        html += '<p class="result-shift">' + (shift.emoji || '') + ' ' + this.esc(blockLabel.toUpperCase()) + ' SHIFT</p>';
      } else {
        html += '<p class="result-shift">' + (shift.emoji || '') + ' ' + this.esc(shift.name).toUpperCase() + ' SHIFT</p>';
      }
      const timeStr = ScheduleEngine.formatShiftTime(shift);
      if (timeStr) html += '<p class="result-time">' + timeStr + '</p>';
      if (blockDetail) html += '<p class="result-block-meta">' + blockDetail + '</p>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  },

  openDayModal(dateStr) {
    const result = this.getResult(dateStr);
    document.getElementById('modal-date-label').textContent = ScheduleEngine.formatDisplayDate(dateStr);
    document.getElementById('modal-result').innerHTML = this.buildResultHTML(dateStr, result, false);
    document.getElementById('modal-overlay').hidden = false;
  },

  closeModal() {
    document.getElementById('modal-overlay').hidden = true;
  },

  /* ---- Helpers ---- */

  getResult(dateStr) {
    return ScheduleEngine.calculateSchedule(
      this.schedule.referenceDate,
      this.schedule.referenceShiftId,
      dateStr,
      this.schedule.rotation,
      this.schedule.shifts,
      this.schedule.referenceCycleIndex
    );
  },

  findShift(id) {
    for (let i = 0; i < this.schedule.shifts.length; i++) {
      if (this.schedule.shifts[i].id === id) return this.schedule.shifts[i];
    }
    return null;
  },

  getShiftColor(shift) {
    if (!shift) return '#6b7a90';
    const name = shift.name.toLowerCase();
    if (name.indexOf('morning') !== -1 || name.indexOf('day') !== -1) return '#16a34a';
    if (name.indexOf('afternoon') !== -1 || name.indexOf('evening') !== -1) return '#d97706';
    if (name.indexOf('night') !== -1) return '#2563eb';
    return '#7c3aed';
  },

  esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /* ---- Collect data from setup form ---- */

  collectShiftsFromDOM() {
    const rows = document.querySelectorAll('.shift-row');
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i].getAttribute('data-shift-id');
      const shift = this.findShift(id);
      if (!shift) continue;
      const fields = rows[i].querySelectorAll('[data-field]');
      for (let j = 0; j < fields.length; j++) {
        shift[fields[j].getAttribute('data-field')] = fields[j].value;
      }
    }
  },

  collectRotationFromDOM() {
    const steps = document.querySelectorAll('.rotation-step');
    for (let i = 0; i < steps.length; i++) {
      const index = parseInt(steps[i].getAttribute('data-index'), 10);
      const step = this.schedule.rotation[index];
      if (!step) continue;
      const typeVal = steps[i].querySelector('[data-field="stepType"]').value;
      if (typeVal === 'off') {
        step.type = 'off';
        step.shiftId = null;
      } else {
        step.type = 'shift';
        step.shiftId = typeVal;
      }
      step.duration = parseInt(steps[i].querySelector('[data-field="duration"]').value, 10) || 1;
    }
  },

  saveSchedule() {
    this.collectShiftsFromDOM();
    this.collectRotationFromDOM();
    this.reconcileRotationWithShifts();
    this.schedule.referenceDate = document.getElementById('ref-date').value;

    const refVal = document.getElementById('ref-shift').value;
    this.schedule.referenceShiftId = refVal === 'off' ? null : refVal;

    const posSelect = document.getElementById('ref-position');
    const posWrap = document.getElementById('ref-position-wrap');
    if (!posWrap.hidden && posSelect) {
      this.schedule.referenceCycleIndex = parseInt(posSelect.value, 10);
    }

    const error = Validator.validateSchedule(this.schedule);
    if (error) {
      this.showError(error);
      return;
    }

    StorageManager.save(this.schedule);
    this.showError('');
    this.showDashboard();
  },

  /* ---- Event bindings ---- */

  bindEvents() {
    const self = this;

    // Setup buttons
    document.getElementById('add-shift-btn').addEventListener('click', function() {
      self.collectShiftsFromDOM();
      self.schedule.shifts.push({
        id: self.uid(),
        name: 'Shift ' + (self.schedule.shifts.length + 1),
        startTime: '', endTime: '', emoji: '⏰'
      });
      self.renderShiftsList();
      self.syncAfterShiftChange(false);
      self.showSetupInfo('New shift added. Adjust rotation steps if needed.');
    });

    document.getElementById('apply-shifts-btn').addEventListener('click', function() {
      self.applyShiftChanges(true);
    });

    document.getElementById('add-step-btn').addEventListener('click', function() {
      self.collectShiftsFromDOM();
      self.collectRotationFromDOM();
      self.schedule.rotation.push({
        type: 'shift',
        shiftId: self.schedule.shifts[0] ? self.schedule.shifts[0].id : null,
        duration: 1
      });
      self.refreshSetupDependents();
    });

    document.getElementById('save-schedule-btn').addEventListener('click', function() {
      self.saveSchedule();
    });

    document.getElementById('cancel-setup-btn').addEventListener('click', function() {
      self.schedule = StorageManager.load() || StorageManager.createDefault();
      self.isEditing = false;
      self.showDashboard();
    });

    // Dashboard buttons
    document.getElementById('edit-schedule-btn').addEventListener('click', function() {
      self.isEditing = true;
      self.showSetup();
    });

    document.getElementById('reset-schedule-btn').addEventListener('click', function() {
      if (confirm('Reset your schedule? This cannot be undone.')) {
        StorageManager.reset();
        self.schedule = StorageManager.createDefault();
        self.showSetup();
      }
    });

    document.getElementById('today-btn').addEventListener('click', function() {
      const today = ScheduleEngine.getToday();
      document.getElementById('lookup-date').value = today;
      self.renderToday(today);
      self.renderLookup(today);
      document.getElementById('today-result').scrollIntoView({ behavior: 'smooth' });
    });

    document.getElementById('check-date-btn').addEventListener('click', function() {
      const date = document.getElementById('lookup-date').value;
      if (date) self.renderLookup(date);
    });

    document.getElementById('program-check-btn').addEventListener('click', function() {
      self.checkProgramShift();
    });

    document.getElementById('program-save-btn').addEventListener('click', function() {
      self.saveProgram();
    });

    document.getElementById('dashboard-screen').addEventListener('click', function(e) {
      const action = e.target.getAttribute('data-action');
      if (action === 'program-remove') {
        const id = e.target.getAttribute('data-id');
        if (id) self.removeProgram(id);
      }
      if (action === 'program-view') {
        const date = e.target.getAttribute('data-date');
        const row = e.target.closest('.program-item');
        const name = row ? row.getAttribute('data-program-name') || '' : '';
        if (date) self.viewProgramDetails(date, name);
      }
    });

    document.getElementById('prev-month-btn').addEventListener('click', function() {
      self.calendarMonth--;
      if (self.calendarMonth < 0) { self.calendarMonth = 11; self.calendarYear--; }
      self.renderCalendar();
    });

    document.getElementById('next-month-btn').addEventListener('click', function() {
      self.calendarMonth++;
      if (self.calendarMonth > 11) { self.calendarMonth = 0; self.calendarYear++; }
      self.renderCalendar();
    });

    document.getElementById('modal-close-btn').addEventListener('click', function() {
      self.closeModal();
    });

    document.getElementById('modal-overlay').addEventListener('click', function(e) {
      if (e.target === this) self.closeModal();
    });

    // Delegated events for setup screen (remove buttons, rotation changes)
    document.getElementById('setup-screen').addEventListener('click', function(e) {
      const action = e.target.getAttribute('data-action');
      if (action === 'remove-shift') {
        const row = e.target.closest('.shift-row');
        const id = row.getAttribute('data-shift-id');
        if (self.schedule.shifts.length <= 1) {
          self.showError('You need at least one shift.');
          return;
        }
        self.collectShiftsFromDOM();
        self.collectRotationFromDOM();
        self.schedule.shifts = self.schedule.shifts.filter(function(s) { return s.id !== id; });
        self.renderShiftsList();
        self.syncAfterShiftChange(true);
      }
      if (action === 'remove-step') {
        const row = e.target.closest('.rotation-step');
        const idx = parseInt(row.getAttribute('data-index'), 10);
        self.collectRotationFromDOM();
        self.schedule.rotation.splice(idx, 1);
        self.refreshSetupDependents();
      }
    });

    let shiftInputTimer = null;
    document.getElementById('setup-screen').addEventListener('input', function(e) {
      if (!e.target.closest('#shifts-list')) return;
      if (!e.target.getAttribute('data-field')) return;
      clearTimeout(shiftInputTimer);
      shiftInputTimer = setTimeout(function() {
        self.collectShiftsFromDOM();
        self.refreshSetupDependents();
      }, 400);
    });

    document.getElementById('setup-screen').addEventListener('focusout', function(e) {
      if (!e.target.closest('#shifts-list')) return;
      if (!e.target.getAttribute('data-field')) return;
      self.collectShiftsFromDOM();
      self.refreshSetupDependents();
    });

    document.getElementById('setup-screen').addEventListener('change', function(e) {
      if (e.target.getAttribute('data-field') === 'stepType' ||
          e.target.getAttribute('data-field') === 'duration') {
        self.collectRotationFromDOM();
        self.renderRotationPreview();
        document.getElementById('cycle-length').textContent =
          ScheduleEngine.getCycleLength(self.schedule.rotation);
        self.renderRefShiftOptions();
      }
      if (e.target.id === 'ref-shift') {
        self.updateRefPositionPicker();
      }
    });

    document.getElementById('ref-position').addEventListener('change', function() {
      self.schedule.referenceCycleIndex = parseInt(this.value, 10);
    });
  }
};


/* ============================================================
   SECTION 6: SELF-TEST (runs on load, logs to console)
   Verifies the scheduling algorithm with known examples.
   ============================================================ */

function runSelfTests() {
  const shifts = [
    { id: 'morning', name: 'Morning', startTime: '06:00', endTime: '14:00', emoji: '☀️' },
    { id: 'afternoon', name: 'Afternoon', startTime: '14:00', endTime: '22:00', emoji: '🌆' },
    { id: 'night', name: 'Night', startTime: '22:00', endTime: '06:00', emoji: '🌙' }
  ];
  const rotation = [
    { type: 'shift', shiftId: 'morning', duration: 2 },
    { type: 'shift', shiftId: 'afternoon', duration: 2 },
    { type: 'shift', shiftId: 'night', duration: 2 },
    { type: 'off', duration: 2 }
  ];
  const ref = '2026-08-12';
  const eng = ScheduleEngine;

  const tests = [
    { date: '2026-08-12', expect: 'morning', label: 'Aug 12 = Morning' },
    { date: '2026-08-13', expect: 'morning', label: 'Aug 13 = Morning' },
    { date: '2026-08-14', expect: 'afternoon', label: 'Aug 14 = Afternoon' },
    { date: '2026-08-15', expect: 'afternoon', label: 'Aug 15 = Afternoon' },
    { date: '2026-08-16', expect: 'night', label: 'Aug 16 = Night' },
    { date: '2026-08-17', expect: 'night', label: 'Aug 17 = Night' },
    { date: '2026-08-18', expect: null, label: 'Aug 18 = OFF' },
    { date: '2026-08-19', expect: null, label: 'Aug 19 = OFF' },
    { date: '2026-08-20', expect: 'morning', label: 'Aug 20 = Morning (new cycle)' },
    { date: '2026-08-11', expect: null, label: 'Aug 11 = OFF (back 1)' },
    { date: '2026-08-10', expect: null, label: 'Aug 10 = OFF (back 2)' },
    { date: '2026-08-01', expect: 'night', label: 'Aug 1 = Night (back 11)' },
    { date: '2027-01-01', expect: 'night', label: 'Jan 1 2027 (year change)' },
    { date: '2024-02-29', expect: 'morning', label: 'Feb 29 2024 (leap year, ref Feb 28)' }
  ];

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const useRef = (t.label.indexOf('Feb 29') !== -1) ? '2024-02-28' : ref;
    const r = eng.calculateSchedule(useRef, 'morning', t.date, rotation, shifts, 0);
    const got = r.isOff ? null : r.shiftId;
    if (got === t.expect) {
      passed++;
    } else {
      failed++;
      console.error('TEST FAIL: ' + t.label + ' – expected ' + t.expect + ', got ' + got);
    }
  }

  // Cycle consistency test: every offset -60 to +60
  for (let d = -60; d <= 60; d++) {
    const date = eng.addDays(ref, d);
    const r = eng.calculateSchedule(ref, 'morning', date, rotation, shifts, 0);
    const expanded = eng.expandRotation(rotation);
    const expectedIdx = eng.mod(0 + d, 8);
    const expected = expanded[expectedIdx];
    const got = r.isOff ? null : r.shiftId;
    if (got !== expected) {
      failed++;
      console.error('CYCLE FAIL at offset ' + d + ' (' + date + ')');
    } else {
      passed++;
    }
  }

  console.log('ShiftCheck self-tests: ' + passed + ' passed, ' + failed + ' failed');
}

// Boot
document.addEventListener('DOMContentLoaded', function() {
  App.init();
  runSelfTests();
});
