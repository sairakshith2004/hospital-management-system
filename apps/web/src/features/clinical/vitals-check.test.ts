import { describe, expect, it } from 'vitest';
import { checkVitals, toCelsius, toFahrenheit } from './VitalsForm';

describe('checkVitals', () => {
  it('converts °F to °C and accepts the reading from the screenshot', () => {
    const r = checkVitals(
      {
        tempC: '99',
        pulse: '100',
        bpSys: '120',
        bpDia: '80',
        respRate: '20',
        spo2: '95',
        weightKg: '65',
        heightCm: '155',
      },
      'F',
    );
    expect(r.errors).toEqual({});
    expect(r.body).toEqual({
      tempC: 37.2,
      pulse: 100,
      bpSys: 120,
      bpDia: 80,
      respRate: 20,
      spo2: 95,
      weightKg: 65,
      heightCm: 155,
    });
  });

  it('explains each field that is out of range, in the unit chosen', () => {
    expect(checkVitals({ tempC: '99' }, 'C').errors).toEqual({
      tempC: 'Temperature must be 30–45 °C',
    });
    expect(checkVitals({ tempC: '37' }, 'F').errors).toEqual({
      tempC: 'Temperature must be 86–113 °F',
    });
    expect(checkVitals({ pulse: '300', spo2: '96.5' }, 'C').errors).toEqual({
      pulse: 'Pulse must be 20–250 /min',
      spo2: 'SpO₂ must be a whole number',
    });
    expect(checkVitals({ bpSys: '120' }, 'C').errors).toEqual({
      bpDia: 'Enter both blood pressure values',
    });
  });

  it('converts both ways to one decimal', () => {
    expect(toCelsius(98.6)).toBe(37);
    expect(toFahrenheit(37)).toBe(98.6);
    expect(toFahrenheit(30)).toBe(86);
    expect(toFahrenheit(45)).toBe(113);
  });
});
