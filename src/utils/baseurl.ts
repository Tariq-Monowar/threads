export const getImageUrl = (imagePath: string) => {
    return `${process.env.BASE_URL}${imagePath}`;
  };
  
  export const baseUrl = process.env.BASE_URL;
  