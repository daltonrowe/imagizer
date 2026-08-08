import { luma } from './shared.js';

export default {
  id: 'greyscale',
  label: 'Greyscale',
  // Runs early: desaturating before a threshold or dither is the usual order.
  stage: 2,
  params: [
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 100, unit: '%', random: [60, 100] },
  ],

  apply(image, { params }) {
    const { data } = image;
    const amount = params.amount / 100;

    for (let i = 0; i < data.length; i += 4) {
      const grey = luma(data[i], data[i + 1], data[i + 2]);
      data[i] += (grey - data[i]) * amount;
      data[i + 1] += (grey - data[i + 1]) * amount;
      data[i + 2] += (grey - data[i + 2]) * amount;
    }
    return image;
  },
};
