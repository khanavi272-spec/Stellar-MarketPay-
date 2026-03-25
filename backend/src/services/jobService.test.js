const { createJob, getJob, listJobs } = require('./jobService');
const store = require('./store');

describe('jobService', () => {
  beforeEach(() => {
    store.jobs.clear();
    store.applications.clear();
  });

  const validClientAddress = 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC'; // 56 chars, starts with G

  describe('createJob', () => {
    it('createJob (valid): should successfully create and store a job', () => {
      const jobData = {
        title: 'Build a decentralized app',
        description: 'Looking for a full-stack developer to build a dApp on Stellar.',
        budget: '500',
        category: 'Smart Contracts',
        skills: ['Rust', 'Soroban'],
        deadline: '2026-12-31T23:59:59Z',
        clientAddress: validClientAddress,
      };

      const job = createJob(jobData);
      
      expect(job.title).toBe(jobData.title);
      expect(job.budget).toBe('500.0000000');
      expect(job.status).toBe('open');
      expect(job.clientAddress).toBe(validClientAddress);
      
      const storedJob = store.jobs.get(job.id);
      expect(storedJob).toBeDefined();
      expect(storedJob.id).toBe(job.id);
    });

    it('createJob (missing title): should throw error for missing or too short title', () => {
      const jobData = {
        title: 'Short',
        description: 'Looking for a full-stack developer to build a dApp on Stellar.',
        budget: '500',
        category: 'Smart Contracts',
        clientAddress: validClientAddress,
      };

      expect(() => createJob(jobData)).toThrow('Title must be at least 10 characters');
      expect(store.jobs.size).toBe(0);
    });

    it('createJob (invalid budget): should throw error for non-positive or invalid budget', () => {
      const jobData = {
        title: 'Build a decentralized app',
        description: 'Looking for a full-stack developer to build a dApp on Stellar.',
        budget: '-100', // Invalid
        category: 'Smart Contracts',
        clientAddress: validClientAddress,
      };

      expect(() => createJob(jobData)).toThrow('Budget must be a positive number');
      
      const jobData2 = { ...jobData, budget: 'abc' };
      expect(() => createJob(jobData2)).toThrow('Budget must be a positive number');
      
      expect(store.jobs.size).toBe(0);
    });
  });

  describe('getJob', () => {
    it('getJob (not found): should throw 404 error when job ID doesn\'t exist', () => {
      expect(() => getJob('nonexistent-id')).toThrow('Job not found');
      try {
        getJob('nonexistent-id');
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });
  });

  describe('listJobs', () => {
    beforeEach(() => {
      createJob({
        title: 'Open Job 1 long enough',
        description: 'This is an open job description that is long enough to pass validation.',
        budget: '100',
        category: 'Frontend Development',
        clientAddress: validClientAddress,
      });

      const inProgressJob = createJob({
        title: 'In Progress Job long enough',
        description: 'This is an in progress job description that is long enough to pass validation.',
        budget: '200',
        category: 'Backend Development',
        clientAddress: validClientAddress,
      });
      // forcibly update status for testing
      store.jobs.get(inProgressJob.id).status = 'in_progress';
      
      createJob({
        title: 'Open Job 2 long enough',
        description: 'This is another open job description that is long enough to pass validation.',
        budget: '300',
        category: 'Frontend Development',
        clientAddress: validClientAddress,
      });
    });

    it('listJobs (filter by status): should return only jobs matching the requested status', () => {
      const openJobs = listJobs({ status: 'open' });
      expect(openJobs.length).toBe(2);
      expect(openJobs.every(j => j.status === 'open')).toBe(true);

      const inProgressJobs = listJobs({ status: 'in_progress' });
      expect(inProgressJobs.length).toBe(1);
      expect(inProgressJobs[0].status).toBe('in_progress');
    });

    it('listJobs (filter by category): should return only jobs matching the requested category', () => {
      // By default listJobs filters by status 'open' if not provided
      const frontendJobs = listJobs({ category: 'Frontend Development' });
      expect(frontendJobs.length).toBe(2);
      expect(frontendJobs.every(j => j.category === 'Frontend Development')).toBe(true);

      const backendJobs = listJobs({ category: 'Backend Development', status: 'in_progress' });
      expect(backendJobs.length).toBe(1);
      expect(backendJobs[0].category).toBe('Backend Development');
    });
  });

  describe('Additional Edge Cases', () => {
    it('listJobsByClient: should return only jobs for the specific client', () => {
      const { listJobsByClient } = require('./jobService');
      const otherClientAddress = 'GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC';
      
      createJob({
        title: 'Job from client A long enough',
        description: 'Description format that is long enough to pass validation.',
        budget: '100',
        category: 'Frontend Development',
        clientAddress: validClientAddress,
      });

      createJob({
        title: 'Job from client B long enough',
        description: 'Description format that is long enough to pass validation.',
        budget: '100',
        category: 'Backend Development',
        clientAddress: otherClientAddress,
      });

      const clientAJobs = listJobsByClient(validClientAddress);
      expect(clientAJobs.length).toBe(1);
      expect(clientAJobs[0].clientAddress).toBe(validClientAddress);
      
      const clientBJobs = listJobsByClient(otherClientAddress);
      expect(clientBJobs.length).toBe(1);
      expect(clientBJobs[0].clientAddress).toBe(otherClientAddress);
    });

    it('updateJobStatus: should properly update the status of the job', () => {
      const { updateJobStatus } = require('./jobService');
      
      const job = createJob({
        title: 'Job to be updated',
        description: 'Description format that is long enough to pass validation.',
        budget: '100',
        category: 'Frontend Development',
        clientAddress: validClientAddress,
      });

      expect(job.status).toBe('open');
      
      const updatedJob = updateJobStatus(job.id, 'cancelled');
      expect(updatedJob.status).toBe('cancelled');
      
      const storedJob = store.jobs.get(job.id);
      expect(storedJob.status).toBe('cancelled');

      expect(() => updateJobStatus(job.id, 'invalid_status')).toThrow('Invalid status');
    });
  });
});
