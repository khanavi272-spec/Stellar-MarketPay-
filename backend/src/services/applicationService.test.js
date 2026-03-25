const { submitApplication, acceptApplication } = require('./applicationService');
const { createJob } = require('./jobService');
const store = require('./store');

describe('applicationService', () => {
  beforeEach(() => {
    store.jobs.clear();
    store.applications.clear();
  });

  const validClientAddress = 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC';
  const validFreelancerAddress = 'GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC'; // Different valid key
  
  let openJob;

  beforeEach(() => {
    openJob = createJob({
      title: 'Build a decentralized app',
      description: 'Looking for a full-stack developer to build a dApp on Stellar.',
      budget: '500',
      category: 'Smart Contracts',
      clientAddress: validClientAddress,
    });
  });

  describe('submitApplication', () => {
    it('submitApplication (valid): should successfully create and store an application', () => {
      const appData = {
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal: 'I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.',
        bidAmount: '450',
      };

      const application = submitApplication(appData);

      expect(application.jobId).toBe(openJob.id);
      expect(application.freelancerAddress).toBe(validFreelancerAddress);
      expect(application.bidAmount).toBe('450.0000000');
      expect(application.status).toBe('pending');

      const storedApp = store.applications.get(application.id);
      expect(storedApp).toBeDefined();
      expect(storedApp.id).toBe(application.id);

      // Verify job applicantCount was incremented
      const updatedJob = store.jobs.get(openJob.id);
      expect(updatedJob.applicantCount).toBe(1);
    });

    it('submitApplication (own job): should throw error if applying to own job', () => {
      const appData = {
        jobId: openJob.id,
        freelancerAddress: validClientAddress, // same as client
        proposal: 'I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.',
        bidAmount: '450',
      };

      expect(() => submitApplication(appData)).toThrow('You cannot apply to your own job');
      expect(store.applications.size).toBe(0);
    });

    it('submitApplication (duplicate): should throw error if already applied', () => {
      const appData = {
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal: 'I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.',
        bidAmount: '450',
      };

      // First submission succeeds
      submitApplication(appData);

      // Second submission fails
      expect(() => submitApplication(appData)).toThrow('You have already applied to this job');
      expect(store.applications.size).toBe(1); // Only 1 app should be stored
    });
  });

  describe('acceptApplication', () => {
    let applicationId;
    let otherApplicationId;

    beforeEach(() => {
      const app1 = submitApplication({
        jobId: openJob.id,
        freelancerAddress: validFreelancerAddress,
        proposal: 'I am a highly experienced Stellar developer with 5 years of Rust experience and I can build this right now.',
        bidAmount: '450',
      });
      applicationId = app1.id;

      const app2 = submitApplication({
        jobId: openJob.id,
        freelancerAddress: 'GCCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC',
        proposal: 'Another great proposal from another freelancer that is long enough to pass validation checks for fifty chars.',
        bidAmount: '500',
      });
      otherApplicationId = app2.id;
    });

    it('acceptApplication (valid): should accept application, reject others, and update job status', () => {
      const acceptedApp = acceptApplication(applicationId, validClientAddress);

      expect(acceptedApp.status).toBe('accepted');
      
      // Check other application
      const rejectedApp = store.applications.get(otherApplicationId);
      expect(rejectedApp.status).toBe('rejected');

      // Check job status
      const updatedJob = store.jobs.get(openJob.id);
      expect(updatedJob.status).toBe('in_progress');
      expect(updatedJob.freelancerAddress).toBe(validFreelancerAddress);
    });

    it('acceptApplication (wrong client): should throw error if non-client tries to accept', () => {
      const wrongClient = 'GDDDDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC'; // Different public key

      expect(() => acceptApplication(applicationId, wrongClient)).toThrow('Only the job client can accept applications');
      
      const app = store.applications.get(applicationId);
      expect(app.status).toBe('pending'); // Unchanged
    });
  });
});
